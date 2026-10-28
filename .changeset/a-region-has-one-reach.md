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
it called from, not the distance it loaded from, and no longer also as a
passenger. A whole-file range that is loaded no longer prints "a hole" or its
stopped cases beneath its `— loaded` header.

With a file graph, a mock's own evaluation counts nowhere: a region that ran at
module load only because the one file importing it mocks it is unwalked — unless
another case runs an import the scan could not read, which may have loaded the
real module, and then it stays loaded — and a stopped case whose only crossing
was its mock's evaluation is not a case that could have reached the region, so
it does not make the region a hole. The
covering commands read the file graph whenever the record marks load time on
the region, on a block or on a crossing, so the mock is told apart on every
answer, not only on `--since`.

`@variance-authority/sense/test-selection` exports `reachOf`, `regionRecord`,
`marksLoadTime` and the `Reach` and `ReachRecord` types. `unenteredState` is removed; `reachOf`
replaces it. A `CoveringRegion` carries `loaded` when its block ran while the
module evaluated. `coveringTests`, `ranWhileLoading` and `stoppedBefore` read
the blocks with a mock's own evaluation dropped when they are given the file
graph; `variance covering --line` and `--function` give it.
