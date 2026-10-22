# Interactive graph explorer (see _dev/GRAPH-EXPLORE.md)
#
# Drills down from the top series one disaggregation at a time. Clicking a
# node offers the out-edges of its dimension-graph node, and right-clicking it
# collapses its children. R supplies the series and the dimension graph. The
# JavaScript in resources/graph-explore finds children by matching key values
# (like walk_children()), so any path through the structure works.
#
# Uses the internals of R/graph-walk.R, which must be sourced first.

#' Explore an aggregated tsibble through its dimension graph
#'
#' @param data An aggregated tsibble, as produced by `aggregate_key()`.
#' @param value The measured variable to plot.
#' @param structure The aggregation structure, shown above the explorer.
#' @param labels Short labels for key values, e.g. `c(Victoria = "VIC")`.
#' @param script Formulas of `variable ~ parent`, as in `graph_walk()`. Each
#'   becomes a fragment that makes that click, so a presenter can drive the
#'   explorer with the clicker and still click freely in between.
graph_explore <- function(data, value, structure, labels = NULL, script = NULL) {
  value <- enquo(value)
  structure <- enexpr(structure)

  s <- walk_series(data, !!value)
  keys <- tsibble::key_vars(data)
  chains <- structure_chains(structure)
  times <- range(data[[tsibble::index_var(data)]])

  graph_widget("graph-explore", list(
    structure = expr_deparse_line(structure),
    value = as_name(value),
    keys = I(keys),
    chains = map(chains, I),
    labels = if (length(labels)) as.list(labels),
    times = I(format(times)),
    # As decimal years, to place the year grid
    years = I(lubridate::decimal_date(as.Date(times))),
    dims = dimension_graph(s, chains),
    series = map(seq_len(nrow(s)), \(i) c(unname(as.list(s[i, keys])), list(I(signif(s$.y[[i]], 4))))),
    script = map(script, \(f) list(parent = walk_node(s, f_rhs(f))$.id, term = as_name(f_lhs(f))))
  ), steps = length(script), step_class = "graph-explore-step", resources = "graph-explore")
}

# Short labels for the tourism data's states
state_abbreviations <- c(
  "New South Wales" = "NSW", "Victoria" = "VIC", "Queensland" = "QLD",
  "South Australia" = "SA", "Western Australia" = "WA", "Tasmania" = "TAS",
  "Northern Territory" = "NT", "ACT" = "ACT"
)

# ---- Internals ---------------------------------------------------------------

# One node per combination of chain levels, with Hasse edges that each add one
# variable. For two chains, the first steps down-left and the second down-right,
# matching the dimension graph slides.
dimension_graph <- function(s, chains) {
  lv <- as.matrix(expand.grid(map(chains, \(v) 0:length(v))))
  k <- length(chains)
  # Nested chains fix variables in order, so a series' level is its count of fixed variables
  series_lv <- sapply(chains, \(v) rowSums(!is.na(as.matrix(s[v]))))
  series_lv <- matrix(series_lv, ncol = k)
  x <- if (k == 1) rep(0, nrow(lv)) else drop(lv %*% seq(-1, 1, length.out = k))
  nodes <- map(seq_len(nrow(lv)), function(i) {
    parts <- compact(map2(chains, lv[i, ], \(v, l) if (l) paste(v[seq_len(l)], collapse = " / ")))
    list(
      levels = I(unname(lv[i, ])),
      name = if (length(parts)) paste(parts, collapse = " × ") else "Total",
      n = sum(apply(series_lv, 1, \(r) all(r == lv[i, ]))),
      x = x[[i]], y = sum(lv[i, ])
    )
  })
  edges <- list()
  for (i in seq_len(nrow(lv))) for (j in seq_len(nrow(lv))) {
    d <- lv[j, ] - lv[i, ]
    if (sum(d) == 1 && all(d >= 0)) {
      ch <- which(d == 1)
      edges[[length(edges) + 1]] <- list(from = i - 1L, to = j - 1L, var = chains[[ch]][[lv[j, ch]]])
    }
  }
  list(nodes = nodes, edges = edges)
}
