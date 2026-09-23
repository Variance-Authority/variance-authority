---
'@variance-authority/core': minor
'@variance-authority/sense': minor
'@variance-authority/cli': minor
'@variance-authority/report': minor
'@variance-authority/tribunal': minor
'@variance-authority/mcp': minor
---

A file whose imports could not all be read no longer widens selection

A `require(name)` or `import('./' + name)` has no written target. The walk uses
the edges that were read in such a file, and the recorded run answers the one
that was not: the module loads under the test however it was named.
`affectedBy` seeds only the changed files, the closure digest does not mark such
a file volatile, and it does not void a deviation baseline.

Removed, not kept as aliases: `Affected.opaque`, `Hole`, `ReachReport.opaque`,
`ReachHole` and `ReachedComponent.throughUnread`.
