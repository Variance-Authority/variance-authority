---
'@variance-authority/sense': minor
'@variance-authority/cli': patch
---

A region has one reach on every covering answer

`variance covering --file`, `--line`, `--function` and the review handover
read whether a region was entered, loaded, a hole, unwalked or unknown from one
function, `reachOf`. Before this, three situations could read two ways:

- A region whose only crossing was a mock evaluating the real module: the whole
  file and `--line` named the mocking case as its loader, while `--function` and
  selection disowned it. Every covering answer now disowns it, as selection
  always did.
- A region that ran while its module evaluated, with no file graph to name who
  loaded it: `--function` called it unwalked and `--line` gave it no state. It
  is loaded.
- A region a producer marked loaded on the crossing: the whole file and `--line`
  listed the case as a caller. It is a passenger.

A case that both loaded a region and called into it is listed at the distance
it called from, not the distance it loaded from. A whole-file range that is
loaded no longer prints "a hole" beneath its `— loaded` header.

`@variance-authority/sense/test-selection` exports `reachOf`, `regionRecord`
and the `Reach` and `ReachRecord` types. `unenteredState` is removed; `reachOf`
replaces it. A `CoveringRegion` carries `loaded` when its block ran while the
module evaluated. `coveringTests` reads owned blocks, so every reader of it —
`covering --line`, the land check and the MCP source-tests answer — drops a
mock's own evaluation.
