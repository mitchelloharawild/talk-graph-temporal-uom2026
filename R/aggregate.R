library(rlang)
parse_agg_nodes <- function(expr){
  tm <- stats::terms(new_formula(lhs = NULL, rhs = expr), env = empty_env())
  nodes <- attr(tm, "factors")
  colnames(nodes) <- NULL
  if(attr(tm, "intercept")){
    nodes <- cbind(0L, nodes)
  }
  nodes
}

edge_to_adjlist <- function(edges) {
  n <- max(edges)
  adj <- vector("list", n)
  groups <- split(edges[, "to"], edges[, "from"])
  adj[as.integer(names(groups))] <- groups
  adj
}

agg_ordered_edges <- function(mat) {
  vc <- colSums(mat)
  n  <- ncol(mat)

  # All (i, j) pairs where i is a strict subset of j
  is_strict_subset <- function(a, b) a < b & apply(mat, 2, \(col_b)
    apply(mat, 2, \(col_a) all(col_a <= col_b))
  )

  # Build full subset relation matrix: sub[i,j] = TRUE if col_i ⊆ col_j
  sub <- outer(seq_len(n), seq_len(n), Vectorize(function(i, j) {
    i != j && vc[i] < vc[j] && all(mat[, i] <= mat[, j])
  }))

  # Keep only covering relations: i -> j where no k exists with i ⊂ k ⊂ j
  covers <- sub & !( sub %*% sub > 0 )

  edges <- which(covers, arr.ind = TRUE)
  colnames(edges) <- c("from", "to")
  edges
}

aggregate_total <- function(.data, .spec = NULL, ...){
  .spec <- enexpr(.spec)
  key_comb <- fabletools:::parse_agg_spec(.spec)
  kv <- unique(unlist(key_comb, recursive = FALSE))
  .data <- as_tibble(.data)
  
  agg_dt <- lapply(unname(key_comb), function(x){
    gd <- group_data(group_by(.data, !!!`names<-`(lapply(x, function(.) expr(graphvec::agg_vec(!!sym(.)))), x)))
    agg_keys <- setdiff(kv, x)
    agg_cols <- rep(list(graphvec::agg_vec(NA, aggregated = TRUE)), length(agg_keys))
    gd[agg_keys] <- agg_cols
    gd
  })
  vctrs::vec_rbind(!!!agg_dt)
}

enum_agg_nodes <- function(data, nodes) {
  apply(nodes, 2, function(node) {
    nrow(distinct(data[names(node)[node > 0L]]))
  })
}
