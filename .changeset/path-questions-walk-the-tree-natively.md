---
'@variance-authority/sense': minor
'@variance-authority/mcp': minor
'@variance-authority/help': patch
---

A path question walks the published source tree in the addon, and no file list crosses into JavaScript

`ask discover`, `ask grep` and `ask search` with `--from` or `--to`, and the MCP `locate` start point, read the published source tree through `SourceTree`, a native handle the addon opens over the segment it writes. The walk, its distances and chains, the files a start point names and the unresolved files are answered there; JavaScript receives only what was reached. `openSourceTree` and `sourceTreeOf` are new in `@variance-authority/sense`.

In `@variance-authority/mcp/tools`, a `Tree` no longer holds `files` as a set: it answers `size`, `has`, `files()` and `entries`, and `unknownFiles()` names its unresolved files. `decodeSourceTree`, `treeAtWorkspace` and `treeFromRelations` are gone: `publishedTreeOf(bytes, root, workspace)` opens published bytes, and `treeOf(records, root, workspace)` takes the workspace itself. The half-hop cost, `hopsFrom`, `hopsTo` and the `hops` field of a scope, is removed; nothing read it. Answers are unchanged.
