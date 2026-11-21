---
'@variance-authority/help': minor
'@variance-authority/sense': minor
---

`variance ask classify`, and `docs_classify` over MCP, rank the areas of the tree a request's words point to after its entities, ten at most, best first: a directory of at most 500 tracked files, scored by the words its path, its files' names and the exported names its files declare hold, a word held by fewer areas counting for more. A request that names no declared name, as most do, still points somewhere, and the best area is asked `search --from` next.

`trackedPaths(root)` lists every file git tracks in a checkout.
