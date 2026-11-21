---
'@variance-authority/help': minor
'@variance-authority/mcp': minor
'@variance-authority/sense': minor
---

`variance ask classify`, and `docs_classify` over MCP, rank the areas of the tree a request's words point to after its entities, ten at most, best first: a directory of at most 500 tracked files, scored by the words its path, its files' names and the top-level names its files declare, exported or not, hold, a word held by fewer areas counting for more. A request that names no declared name, as most do, still points somewhere, and the best area is asked `search --from` next. `--from` and `--to` rank only the files a start point reaches along the imports: in a monorepo of many products, a product's folder and the shared code it imports.

`trackedPaths(root)` lists every file git tracks in a checkout. `saysStartPoint(input)` says whether a call named `from` or `to`, the `wants` of every tool that takes a start point.
