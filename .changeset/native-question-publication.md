---
'@variance-authority/help': minor
'@variance-authority/sense': minor
'@variance-authority/package': minor
'@variance-authority/core': minor
'@variance-authority/cli': minor
'@variance-authority/mcp': minor
---

Workspace questions keep source facts in the native index

`readWorkspace` updates the source index and publishes declarations, usage,
ranking and README mentions in the native reader. Authoritative `changed` paths
use the same native Git listing and worktree acquisition as ordinary updates.

The `records` option of workspace reads is removed. Use the `tree` callback to
query the published graph. Workspace snapshots also use `tree` in place of
`records`. `taints` keeps its contract: addition-only taints, `--taint-file`
among them, join the tree in the native reader, and a subtractive taint is
refused as before. Test loads of real modules beside mocks remain in that graph.

Source-backed selection and name questions use batched native graph queries.
The graph stays in Rust, including journey selection. The former JavaScript
scanner, whole-index record readers and mutable source caches are removed.

The standalone `@variance-authority/package/help` `readHelp` and `assembleHelp`
APIs are removed. Use `await readWorkspace(root)` from `@variance-authority/help`.
`writePages` is now asynchronous and uses that same reader.
