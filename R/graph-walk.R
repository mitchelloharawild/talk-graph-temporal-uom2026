# Animated graph walks that explain graph pruning (see _dev/GRAPH-WALK-ANIMATION.md)
#
# R computes everything the audience sees: which series are visited, their
# features, and every pruning decision. The JavaScript in resources/graph-walk
# only lays out and animates that data, stepping with the slide's fragments
# (graph_walk()) or playing once when the slide is shown (graph_recap()).

library(rlang)
library(purrr)
library(dplyr)
library(htmltools)

#' Step through the disaggregations of an aggregated tsibble
#'
#' Each formula in `splits` disaggregates the series identified by its right
#' hand side (`Total` is the top series) by the key variable on its left hand
#' side. With a `.predicate`, each disaggregation takes two fragments: its
#' series are tested, then `.keep` decides if the group is kept or pruned.
#'
#' @param data An aggregated tsibble, as produced by `aggregate_key()`.
#' @param value The measured variable to plot and test.
#' @param structure The aggregation structure, shown above the walk.
#' @param splits Formulas of `variable ~ parent`, in the order they're walked.
#' @param .predicate,.keep As in `prune_aggregates()`.
graph_walk <- function(data, value, structure, splits, .predicate = NULL, .keep = NULL) {
  value <- enquo(value)
  structure <- enexpr(structure)
  .predicate <- enquo(.predicate)
  prune <- !quo_is_null(.predicate)
  keep <- if (prune) eval_tidy(enquo(.keep)) else NULL

  s <- walk_series(data, !!value)
  keys <- tsibble::key_vars(data)
  root <- walk_node(s, quote(Total))

  steps <- map(splits, function(f) {
    parent <- walk_node(s, f_rhs(f))
    var <- as_name(f_lhs(f))
    kids <- walk_children(s, keys, parent, var)
    list(parent = parent$.id, term = var, kids = kids$.id, labels = kids[[var]])
  })

  visited <- bind_rows(
    tibble(id = root$.id, label = "Total", parent = NA_character_),
    map(steps, \(x) tibble(id = x$kids, label = x$labels, parent = x$parent))
  ) |>
    distinct(id, .keep_all = TRUE)
  chains <- structure_chains(structure)
  nodes <- pmap(visited, function(id, label, parent) {
    node <- s[s$.id == id, ]
    tested <- if (prune) predicate_features(.predicate, node$.y[[1]], as_name(value))
    list(
      id = id, label = label, depth = node$.depth, parent = parent,
      series = I(block_range(node$.y[[1]])),
      mean = mean(node$.y[[1]]),
      pass = tested$pass, features = tested$features,
      dims = next_dims(node, chains)
    )
  })
  pass <- set_names(map_lgl(nodes, \(n) isTRUE(n$pass)), visited$id)
  steps <- map(steps, \(x) list(
    parent = x$parent, term = x$term, kids = I(x$kids),
    kept = if (prune) isTRUE(keep(pass[x$kids]))
  ))

  graph_widget("graph-walk", list(
    structure = expr_deparse_line(structure),
    value = as_name(value),
    keys = I(keys),
    rule = if (prune) rule_text(.predicate, enquo(.keep)),
    threshold = if (prune) predicate_threshold(.predicate, as_name(value)),
    nodes = nodes,
    splits = steps
  ), steps = length(splits) * if (prune) 2 else 1)
}

#' Rapidly replay pruning over the whole graph, depth first
#'
#' Each formula in `paths` is one order of disaggregation, e.g.
#' `~ continent / subContinent / country`. The paths are walked one after the
#' other from the top series, testing every child and only going deeper below
#' passing series of kept disaggregations.
graph_recap <- function(data, value, structure, paths, .predicate, .keep) {
  value <- enquo(value)
  structure <- enexpr(structure)
  .predicate <- enquo(.predicate)
  keep <- eval_tidy(enquo(.keep))

  s <- walk_series(data, !!value)
  keys <- tsibble::key_vars(data)
  s$.pass <- map_lgl(s$.y, \(y) predicate_features(.predicate, y, as_name(value))$pass)

  walks <- map(paths, function(path) {
    vars <- all.vars(path)
    # Visiting order: [parent index, depth, passes, label]
    out <- list(list(-1L, 0L, TRUE, "Total"))
    visit <- function(node, idx, depth) {
      if (depth == length(vars)) return()
      kids <- walk_children(s, keys, node, vars[[depth + 1]])
      # Children are numbered from here (0-based, for JavaScript)
      start <- length(out)
      for (i in seq_len(nrow(kids))) {
        out[[length(out) + 1]] <<- list(idx, depth + 1L, kids$.pass[[i]], if (depth == 0) kids[[vars[[1]]]][[i]] else "")
      }
      if (isTRUE(keep(kids$.pass))) {
        for (i in which(kids$.pass)) visit(kids[i, ], start + i - 1L, depth + 1)
      }
    }
    visit(walk_node(s, quote(Total)), 0L, 0)
    list(vars = I(vars), nodes = out)
  })

  graph_widget("graph-recap", list(
    structure = expr_deparse_line(structure),
    keys = I(keys),
    rule = rule_text(.predicate, enquo(.keep)),
    paths = walks
  ))
}

#' Add an illustrative series to an aggregated tsibble
#'
#' The series is zero, except for a single 1 at a random time. Key variables
#' given in `...` are set, the rest are aggregated.
add_example_series <- function(data, ..., at = NULL) {
  keys <- tsibble::key_vars(data)
  given <- list2(...)
  index <- tsibble::index_var(data)
  times <- sort(unique(data[[index]]))
  at <- at %||% times[sample.int(length(times), 1)]
  new <- tibble(!!index := times)
  for (m in tsibble::measured_vars(data)) new[[m]] <- as.numeric(times == at)
  for (k in keys) {
    new[[k]] <- if (k %in% names(given)) {
      fabletools::agg_vec(given[[k]], aggregated = FALSE)
    } else {
      fabletools::agg_vec(NA_character_, aggregated = TRUE)
    }
  }
  dplyr::bind_rows(tsibble::as_tibble(data), new) |>
    tsibble::as_tsibble(index = !!sym(index), key = all_of(keys))
}

# ---- Internals ---------------------------------------------------------------

# One row per series, with aggregated key values as NA and the series in `.y`
walk_series <- function(data, value) {
  keys <- tsibble::key_vars(data)
  s <- data |>
    tsibble::as_tibble() |>
    arrange(!!tsibble::index(data)) |>
    mutate(across(all_of(keys), \(k) ifelse(fabletools::is_aggregated(k), NA_character_, as.character(k)))) |>
    summarise(.y = list(!!enquo(value)), .by = all_of(keys))
  s$.depth <- rowSums(!is.na(as.matrix(s[keys])))
  s$.id <- do.call(paste, c(s[keys], sep = "|"))
  s
}

# The most aggregated series matching `cond`, or the top series for `Total`
walk_node <- function(s, cond) {
  hit <- if (identical(cond, quote(Total))) s$.depth == 0 else eval_tidy(cond, s) %in% TRUE
  hit <- hit & s$.depth == min(s$.depth[hit])
  s[hit, ]
}

# Series disaggregating `parent` by `var`
walk_children <- function(s, keys, parent, var) {
  hit <- !is.na(s[[var]])
  for (k in keys[!is.na(unlist(parent[keys]))]) hit <- hit & s[[k]] %in% parent[[k]]
  if (!any(hit)) return(s[0, ])
  s[hit & s$.depth == min(s$.depth[hit]), ] |> arrange(.data[[var]])
}

# Variables of each nested chain in the structure, e.g. a*(b/c) -> list("a", c("b", "c"))
structure_chains <- function(x) {
  if (is_call(x, "*")) return(c(structure_chains(x[[2]]), structure_chains(x[[3]])))
  if (is_call(x, "(")) return(structure_chains(x[[2]]))
  list(all.vars(x))
}

# Variables the node can still be disaggregated by
next_dims <- function(node, chains) {
  unlist(lapply(chains, \(vars) vars[is.na(unlist(node[vars]))][1])) |> discard(is.na) |> as.list()
}

# The predicate split into its `&` terms, each with the value it compares
predicate_terms <- function(x) {
  if (is_call(x, c("&", "&&"))) return(c(predicate_terms(x[[2]]), predicate_terms(x[[3]])))
  list(x)
}

predicate_features <- function(.predicate, y, value) {
  env <- set_names(list(y), value)
  features <- map(predicate_terms(quo_get_expr(.predicate)), function(term) {
    lhs <- if (is_call(term, c(">", "<", ">=", "<="))) term[[2]] else term
    v <- eval_tidy(lhs, env, quo_get_env(.predicate))
    # Proportions, like mean(y == 0), read best as percentages
    is_prop <- is_call(lhs, "mean") && is_call(lhs[[2]], c("==", "!=", ">", "<", ">=", "<="))
    list(
      text = if (is_prop) paste0(round(100 * v), "%") else if (v >= 100) format(round(v)) else sprintf("%.1f", v),
      pass = isTRUE(eval_tidy(term, env, quo_get_env(.predicate)))
    )
  })
  list(pass = all(map_lgl(features, "pass")), features = features)
}

# The threshold of a `mean(value) > c` term, drawn on the series
predicate_threshold <- function(.predicate, value) {
  for (term in predicate_terms(quo_get_expr(.predicate))) {
    if (is_call(term, c(">", ">=")) && is_call(term[[2]], "mean", n = 1) &&
      identical(term[[2]][[2]], sym(value)) && is.numeric(term[[3]])) {
      return(term[[3]])
    }
  }
  NULL
}

rule_text <- function(.predicate, .keep) {
  keep <- quo_get_expr(.keep)
  if (is_call(keep, c("function", "\\"))) keep <- keep[[3]]
  paste0(".predicate = ", expr_deparse_line(quo_get_expr(.predicate)), "    .keep = ", expr_deparse_line(keep))
}

expr_deparse_line <- function(x) paste(expr_deparse(x, width = Inf), collapse = " ")

# The range of each fortnight, in time order: enough resolution for the small
# multiples, while keeping isolated spikes (like a single page view) visible
block_range <- function(y, n = 14) {
  blocks <- split(y, ceiling(seq_along(y) / n))
  unlist(lapply(blocks, \(b) if (which.min(b) < which.max(b)) range(b) else rev(range(b))), use.names = FALSE) |>
    signif(3)
}

# Quarto copies a dependency once per name and version (into site_libs), so the
# version changes with the files' contents or edits would never reach the deck
resource_version <- function(dir) {
  md5 <- tools::md5sum(list.files(dir, full.names = TRUE))
  paste0("1.0.", sum(strtoi(substr(md5, 1, 7), 16L)) %% 1e8)
}

graph_widget <- function(class, spec, steps = 0, step_class = "graph-walk-step", resources = "graph-walk") {
  json <- jsonlite::toJSON(spec, auto_unbox = TRUE, null = "null", na = "null", digits = NA)
  tagList(
    div(
      class = class,
      tags$script(type = "application/json", HTML(gsub("</", "<\\/", json, fixed = TRUE)))
    ),
    lapply(seq_len(steps), \(i) span(class = paste("fragment", step_class))),
    htmlDependency(
      resources, resource_version(file.path("resources", resources)),
      src = normalizePath(file.path("resources", resources)),
      script = paste0(resources, ".js"), stylesheet = paste0(resources, ".css")
    )
  )
}
