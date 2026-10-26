# Reviewing `@variance-authority/observe`

Compares two render documents or rasters of one subject and answers with one
`Observation`: a verdict, the pixels that differ, and the component and
`file:line` behind each region when a snapshot and a source index are given. The
CLI and the collectors call it with a renderer and a `RasterStore`.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/observe/`.

## Contracts

- **A moved identity is a cause, not a verdict.** Two images are always
  compared, and a moved machine or recipe opens `because`. Written in
  [ADR-0090](../../docs/context/adr/0090-a-moved-identity-is-a-cause-not-a-verdict.md);
  pinned by [src/foreign.test.ts](src/foreign.test.ts) › "compares two painters
  and names them as the cause".
- **One side's evidence is a change; an observed empty tree is a reading.**
  Written in ADR-0090 §7; pinned by [src/signals.test.ts](src/signals.test.ts) ›
  "reports one-sided accessibility evidence as a change instead of reading it as
  empty" and "treats an observed empty ARIA tree as a signal rather than missing
  evidence".
- **`unchanged` means nothing past the default tolerance**, and names what it
  forgave. Written in [README › Read the verdict](README.md#read-the-verdict);
  pinned by [src/forgiveness.test.ts](src/forgiveness.test.ts) › "reports a
  border-token edit as a change" and "says no pixels differ only when none do".
- **A sensitivity absorbs only its bands**, and a baseline without component
  hashes is reported in full. Written in [README › What else an observation
  reports](README.md#what-else-an-observation-reports); pinned by
  [src/sensitivity.test.ts](src/sensitivity.test.ts) › "reports in full when the
  baseline carries no component hashes".
- **Moved content and an unpainted document are changes.** Pinned by
  [src/moved.test.ts](src/moved.test.ts) › "is changed when a gap grew in one
  place and shrank in another, at the same height" and
  [src/unpictured.test.ts](src/unpictured.test.ts) › "is changed when the nodes
  outside every component moved".
- **Absent causes are `undefined`, never `[]`, and a warm cache never answers
  for this run.** Written in the README section above; pinned by
  [src/causes.test.ts](src/causes.test.ts) › "answers `undefined`, not an empty
  list" and "does not let a previous run’s hashes answer for this one".
- **A packed snapshot is recorded only if every node is one.** Pinned by
  [src/packed.test.ts](src/packed.test.ts) › "is not recorded when a node below
  its root is not a node".
- **It never writes a baseline**, and answers alike through every store. Written
  in [README › Approving the first image](README.md#approving-the-first-image);
  pinned by [src/parity.test.ts](src/parity.test.ts) › "does not record a new
  baseline when the store cannot be reached".

## Not this package's

- Where a baseline lives, and approval: `@variance-authority/store` and the
  CLI's `variance accept`. Pixel policies: `@variance-authority/raster`.
