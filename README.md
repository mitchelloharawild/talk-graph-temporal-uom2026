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

Forecasting in practice rarely involves a single time series. Organisations forecast large collections of related series, such as product sales across stores and regions, or website traffic across pages and devices. Software for forecasting at scale must handle many series and models consistently, and produce probabilistic forecasts that can be evaluated, combined, and compared. The fable R package addresses this by treating forecasting as a workflow of distinct, composable stages that exchange a tidy data model, making forecasting flexible, consistent, and extensible.

The related nature of a collection of time series is commonly described by aggregation constraints, such as national forecasts being the sum of state forecasts. Forecast reconciliation uses these constraints to improve forecast accuracy and produce coherent forecasts. Hierarchical and grouped structures are typically visualised with trees and computed with matrix algebra, but are limited in the relations they can represent. Directed acyclic graphs (DAGs) provide a more general representation that can describe partial reconciliation via disjoint graphs, remove redundant aggregation with unbalanced trees, and allow sparse aggregation constraints from different levels of disaggregated series.

Graph representations of coherency also make the collection of series easier to explore and manipulate. When series are disaggregated by many attributes, the number of series grows quickly, making forecasting computationally expensive and degrading the accuracy of aggregated series due to noisy, uninformative, or misspecified disaggregated series. Time series features can be used to identify unwanted series, with graph search algorithms used to efficiently prune uninformative subgraphs while preserving coherency. This substantially reduces the number of series to forecast, while retaining most of the information.

This seminar begins with the software design of fable for forecasting at scale, which motivates the need for graphs to represent related collections of time series. It then introduces graph-based forecast reconciliation and feature-based graph pruning, demonstrating how they enable scalable and accurate forecasting of structured time series.

#### Structure

> Software design for forecasting at scale (<10 minutes)

* Forecasting is more than fitting a model: the forecasting workflow
* Forecasting at scale needs consistent, extensible, and probabilistic tools
* The fable framework: composable stages and a tidy data model
* Forecasting many related series: why we need to represent their relationships

> Reconciliation with graphs (~20 minutes)

* The basics of forecast reconciliation
* Hierarchical and grouped coherence
* Graph coherence
* Disjoint graphs (cross-validation, incomplete reconciliation)
* Unbalanced trees
* Data exploration with graphs
* Forecast reconciliation on graphs

> Pruning graphs (~20 minutes)

* The curse of dimensionality in reconciliation: large scale and inaccurate
* Introduction to the fpp3 pageviews data
* Accuracy of incoherent vs coherent forecasts at various depths
* Visually traversing the graph: sparse and noisy series
* Feature-based pruning of coherency constraints using graph search
* Improved computational complexity and forecast accuracy
* Opportunities for more dimensions of disaggregation

> Future work and questions (~10 minutes)

* Better measures of 'forecast-ability'
* Lumping unwanted series together
* Graph vocabulary for specifying which time series to keep
* Finishing the implementation and software design

### Format

60 minute seminar (50 minute talk, 10 minute Q&A)
