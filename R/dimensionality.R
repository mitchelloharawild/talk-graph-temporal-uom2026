# Series-count formulas for illustrating dimensionality growth in sections/background.qmd.
total_hierarchical_series <- function(n_levels, depth = length(n_levels)) {
  sum(vapply(0:depth, function(k) prod(n_levels[seq_len(k)]), numeric(1L)))
}

total_grouped_series <- function(n_levels, depth = length(n_levels)) {
  if(length(n_levels) == 1L) return(1 + n_levels)
  1 + sum(vapply(seq_len(depth), function(k) sum(combn(n_levels, k, FUN = prod)), numeric(1L)))
}
