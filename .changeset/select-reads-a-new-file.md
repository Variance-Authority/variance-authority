---
'@variance-authority/cli': patch
---

`variance select` and the runner seams measure a test's hops on the checkout's imports, not on the last `variance index`: the selection brings the source index up to the checkout before it reads the graph, paying only for the files that moved. Before, a test that imported a file added since the index, or that moved its import from one indexed file to another, was measured on the old edges and could be left out of `--at-distance 0-1`. When the index cannot be updated, a leg cuts nothing by hops: it runs every selected test file and says why.
