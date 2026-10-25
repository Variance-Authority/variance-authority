---
'@variance-authority/sense': minor
'@variance-authority/cli': patch
---

A region has one reach on every covering answer

`variance covering --file`, `--function`'s unrun parts and the review handover
read whether a region was entered, loaded, a hole or unwalked from one function,
`reachOf`. Before this, three regions could read two ways:

- A region whose only crossing was a mock evaluating the real module: the whole
  file named the mocking case as its loader, while `--function` and selection
  disowned it. Every covering answer now disowns it.
- A region that ran while its module evaluated, with no file graph to name who
  loaded it: `--function` called it unwalked. It is loaded.
- A region a producer marked loaded on the crossing: the whole file listed the
  case as a caller. It is a passenger.

`@variance-authority/sense/test-selection` exports `reachOf`, `regionRecord`
and the `Reach` and `ReachRecord` types. `unenteredState` is removed; `reachOf`
replaces it. A `CoveringRegion` carries `loaded` when its block ran while the
module evaluated.
