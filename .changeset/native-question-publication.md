---
'@variance-authority/help': minor
'@variance-authority/sense': minor
---

Workspace questions keep source facts in the native index

`readWorkspace` updates the source index and publishes declarations, usage,
ranking and README mentions in the native reader. Authoritative `changed` paths
use the same native Git listing and worktree acquisition as ordinary updates.

The `records` and arbitrary `taints` options of workspace reads are removed.
Use the `tree` callback to query the published graph. Test loads of real modules
beside mocks remain in that graph. Workspace snapshots also use `tree` in place
of `records`; old runtime callbacks receive an explicit refusal.
