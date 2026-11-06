---
'@variance-authority/cli': minor
'@variance-authority/help': minor
'@variance-authority/mcp': minor
---

`ask grep` and `ask discover --text` with no start point now say how to name one, the file or folder you are working in, and no longer send you to `rg`. A start point that says the root, as `.`, `./` or its absolute path, is refused as the root, not as a path the tree lacks, and `refusalFor` now takes the tree's root as its second argument.
