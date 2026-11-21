---
'@variance-authority/help': minor
'@variance-authority/mcp': minor
'@variance-authority/cli': patch
---

`variance ask classify`, and `docs_classify` over MCP, rank the areas of the tree a request's words point to after its entities, ten at most, best first: a directory of at most 500 tracked files, scored by the words its path, its files' names and the top-level names its files declare, exported or not, hold, a word held by fewer areas counting for more. Each area names the package on the code map nearest at or above it, with that package's area and layer on the code map. A request that names no declared name, as most do, still points somewhere, and `search` is asked next from the best area that declares a name, or from the start point the asker said. `--from` and `--to` rank only the files a start point reaches along the imports: in a monorepo of many products, a product's folder and the shared code it imports, in a nested workspace whose members reach beside its directory as in any other.

`saysStartPoint(input)` says whether a call named `from` or `to`, the `wants` of every tool that takes a start point. `saturation(held, length, total, rows)` is the BM25 saturation of a term's count in thousandths, which `search`'s described rows and `classify`'s areas share.
