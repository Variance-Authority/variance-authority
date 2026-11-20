---
'@variance-authority/sense': patch
---

The code map no longer walks the import graph once per package

`variance index` now works out how much code each package pulls in with one pass over the import graph per 64 packages. Before, it walked the graph once for every package. It also used to scan every package edge for every area of the map; now each area reads only the edges that touch it. On a generated monorepo of 12,000 layered packages and 264,000 files, `writing the code map` drops from about 26 s to about 3 s. The map it writes is byte-identical, and Kibana and Firefox are unchanged.
