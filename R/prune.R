library(rlang)
library(purrr)
library(dplyr)
library(tsibble)

source("R/aggregate.R")

# Number of rows of a local or remote table
n_rows <- function(x) {
  if (is.data.frame(x)) nrow(x) else as.integer(pull(count(x), n))
}

# semi_join() where a zero-length `by` keeps all of `x` if `y` has any rows.
# Used by the root node, which has no key variables to join by.
semi_prune <- function(x, y, by) {
  if (length(by)) semi_join(x, y, by = by) else if (n_rows(y)) x else filter(x, FALSE)
}

# Rewrite `.keep` as an expression of `arg`, inlining the body of functions
# written by the user so that database backends (which cannot evaluate R
# functions) can translate the test.
keep_expr <- function(.keep, arg) {
  fn <- eval_tidy(.keep)
  inline <- is_closure(fn) && !is_namespace(fn_env(fn)) &&
    !identical(fn_env(fn), baseenv())
  if (!inline) {
    return(new_quosure(call2(quo_get_expr(.keep), arg), quo_get_env(.keep)))
  }
  new_quosure(
    eval(call("substitute", fn_body(fn), set_names(list(arg), names(fn_fmls(fn))[[1L]]))),
    fn_env(fn)
  )
}

#' Walk an aggregation graph, pruning aggregations which are not worth using
#'
#' Nodes are visited breadth first, from the most to the least aggregated, so
#' each series is tested exactly once regardless of how many parents it has. A
#' node is only reached from a parent which still has series left to
#' disaggregate, and a disaggregation is only used if `.keep` of its series'
#' predicate results holds.
#'
#' `.test(node, parents, from_parent)` returns a table of the node's key
#' variables and a `.keep` column holding the predicate result for each of its
#' series. `from_parent(x, p)` restricts `x` to the series which disaggregate a
#' kept series of parent `p`, and is passed in because which series those are is
#' only known part way through the walk.
#'
#' `.keep_node(node, .use)` is called with the series of `node` that a parent
#' voted to use, in the same order the nodes are visited.
#'
#' This is shared between [prune_aggregates()], which aggregates as it walks,
#' and `fc_prune_select()`, which walks a graph that has already been
#' aggregated and stored.
prune_walk <- function(g_vars, g_edges, .keep, .test, .keep_node) {
  g_parents <- split(
    g_edges[, "from"], factor(g_edges[, "to"], levels = seq_along(g_vars))
  )

  # Series of each node which are worth disaggregating further
  .pass <- vector("list", length(g_vars))

  # Key variables of a parent node, where NULL is the (key free) root node
  parent_vars <- function(p) if (is.null(p)) character() else g_vars[[p]]
  # Restrict `x` to the series which disaggregate a kept series of parent `p`
  from_parent <- function(x, p) {
    if (length(parent_vars(p))) semi_join(x, .pass[[p]], by = parent_vars(p)) else x
  }

  # Visit each node after its parents, which always use fewer key variables
  for (node in order(lengths(g_vars))) {
    # Parents with series left to disaggregate; the root is reached from nowhere
    parents <- as.list(keep(g_parents[[node]], function(p) !is.null(.pass[[p]])))
    if (!length(g_vars[[node]])) parents <- list(NULL)
    if (!length(parents)) next

    # Test each series of this node once, however many parents it has
    .test_node <- .test(node, parents, from_parent)

    # Each parent decides whether the series it disaggregates should be used
    .use <- compute(reduce(map(parents, function(p) {
      .votes <- mutate(from_parent(.test_node, p), .use = !!.keep, .by = all_of(parent_vars(p)))
      select(filter(.votes, .use), !.use)
    }), union))
    if (!n_rows(.use)) next

    .keep_node(node, .use)

    # Series which satisfy the predicate are disaggregated by the child nodes
    .pass_node <- compute(filter(.use, .keep))
    if (n_rows(.pass_node)) .pass[[node]] <- .pass_node
  }

  invisible(NULL)
}

#' Aggregate a graph of series, pruning aggregations which are not worth using
#'
#' Each node of the aggregation graph described by `.spec` is aggregated with
#' `...`, and each of its series is tested with `.predicate`. A series is only
#' disaggregated by its child nodes if it passes the predicate, and a set of
#' disaggregated series is only used if `.keep` of their predicate results
#' holds. Nodes are visited breadth first, from the most to the least
#' aggregated, so each series is aggregated and tested exactly once regardless
#' of how many parents it has.
#'
#' All computation uses dplyr verbs on `.data`, which may be a tsibble, a data
#' frame, or a lazy table backed by a database connection. `.predicate` and
#' `.keep` are evaluated by the backend, so for a database they must be
#' translatable to SQL (`mean(as.numeric(x)) > 0.3` rather than `mean(x) > 0.3`,
#' as SQL cannot average a boolean).
prune_aggregates <- function(.data, .spec = NULL, .predicate = NULL, ...,
                             .keep = any, .index = NULL) {
  .spec <- enexpr(.spec)
  .keep <- keep_expr(enquo(.keep), sym(".keep"))
  # Captured here rather than embraced at the point of use, because the walk
  # evaluates it from inside a callback where `.predicate` is no longer an
  # argument of the enclosing function
  .predicate <- enquo(.predicate)

  # The index and interval are known for a tsibble, otherwise `.index` names it
  if (inherits(.data, "tbl_ts")) {
    .idx <- index_var(.data)
    .intvl <- interval(.data)
    .data <- as_tibble(.data)
  } else {
    .idx <- as_string(ensym(.index))
    .intvl <- NULL
  }
  .cn <- colnames(.data)

  # Form a meta-graph of aggregation structure
  g_nodes <- parse_agg_nodes(.spec)
  g_kv <- rownames(g_nodes)
  g_vars <- apply(g_nodes, 2L, function(x) g_kv[x != 0L], simplify = FALSE)
  g_edges <- agg_ordered_edges(g_nodes)

  # Distinct key combinations, used to identify the series of each node
  .keys <- compute(distinct(.data, !!!syms(g_kv)))

  # Aggregations kept by each node, and the node currently being aggregated
  .agg <- vector("list", length(g_vars))
  .agg_node <- NULL

  prune_walk(g_vars, g_edges, .keep,
    .test = function(node, parents, from_parent) {
      .by <- g_vars[[node]]

      # Aggregate only the series which disaggregate a kept parent series
      if (length(.by)) {
        .series <- reduce(
          map(parents, function(p) from_parent(distinct(.keys, !!!syms(.by)), p)), union
        )
        .data_node <- semi_join(.data, .series, by = .by)
      } else {
        .data_node <- .data
      }
      .agg_node <<- compute(summarise(.data_node, ..., .by = all_of(c(.by, .idx))))
      compute(summarise(.agg_node, .keep = !!.predicate, .by = all_of(.by)))
    },
    .keep_node = function(node, .use) {
      # Keep these aggregations. The key variables of this node identify the
      # series, and the rest are marked as aggregated, so that nodes bind
      # together whatever type the key variables have.
      .by <- g_vars[[node]]
      kept <- collect(semi_prune(.agg_node, .use, .by))
      kept[.by] <- lapply(kept[.by], graphvec::agg_vec)
      kept[setdiff(g_kv, .by)] <- list(graphvec::agg_vec(NA, TRUE))
      .agg[[node]] <<- kept
    }
  )

  if (every(.agg, is.null)) {
    abort("No aggregations satisfied `.keep`, so no series can be kept.")
  }

  # Return all aggregated series which are kept, as a tsibble
  .data <- bind_rows(.agg)
  .data <- .data[union(intersect(.cn, colnames(.data)), colnames(.data))]
  .data <- arrange(.data, !!!syms(c(g_kv, .idx)))

  build_tsibble_meta(
    .data,
    # With the new key variables
    key_data = group_data(group_by(.data, !!!syms(g_kv))),
    # With the correct index variable
    index = .idx, index2 = .idx,
    # And same properties as before
    ordered = TRUE,
    interval = .intvl %||% interval_pull(.data[[.idx]])
  )
}
