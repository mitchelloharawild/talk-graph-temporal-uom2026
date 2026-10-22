---
format: gfm
---

<!-- README.md is generated from README.qmd. Please edit that file -->

# Graphs for forecasting many related time series

<!-- badges: start -->
<!-- badges: end -->

Slides and notes for a seminar at the University of Melbourne (23rd October 2026, 11am).

Slides: <https://slides.mitchelloharawild.com/UoM2026>

#### Abstract

Forecasting in practice rarely involves a single time series. Organisations forecast large collections of related series, such as product sales across stores and regions, which requires software that handles many series and models consistently and produces probabilistic forecasts that can be evaluated, combined, and compared. The fable R package addresses this by treating forecasting as a workflow of composable stages designed with tidy data analysis principles. The relationships between related time series are commonly encoded with aggregation constraint matrices, which forecast reconciliation uses to produce coherent and more accurate forecasts. Directed acyclic graphs (DAGs) offer a more general representation that make large collections of series easier to explore and manipulate. As series are disaggregated by many attributes, their number grows rapidly, increasing computational cost and degrading accuracy through noisy, uninformative, or misspecified series. Using time series features and graph search algorithms, uninformative subgraphs can be efficiently pruned while preserving coherency, substantially reducing the number of series to forecast while retaining most of the information. This seminar begins with the software design of fable for forecasting at scale, then introduces graph-based forecast reconciliation and feature-based graph pruning for accurate forecasting at scale.

#### Structure

> Software design for forecasting at scale (<10 minutes)

* Forecasting is more than fitting a model: the forecasting workflow
* Forecasting at scale needs consistent, extensible, and probabilistic tools
* The fable framework: composable stages and a tidy data model
* Forecasting many related series: why we need to represent their relationships

> Reconciliation with graphs (~20 minutes)

* The basics of forecast reconciliation
* Hierarchical and grouped coherence
* Temporal coherence
* Graph coherence
* Unbalanced graphs (mixed frequencies, multiple measurement approaches)
* Disjoint graphs (cross-validation, incomplete reconciliation)
* Forecast reconciliation on graphs
* Data exploration with graphs

> Pruning graphs (~20 minutes)

* The curse of dimensionality in reconciliation: large scale and inaccurate
* Introduction to the fpp3 pageviews data
* Visually traversing the graph: sparse and noisy series
* Feature-based pruning of coherency constraints using graph search (fpp3)
* Results on Favorita grocery sales: accuracy at depth, pruned accuracy, and computation
* Opportunities for more dimensions of disaggregation

> Future work and questions (~10 minutes)

* Better measures of 'forecast-ability'
* Lumping unwanted series together
* Graph vocabulary for specifying which time series to keep
* Finishing the implementation and software design

### Format

60 minute seminar (50 minute talk, 10 minute Q&A)
