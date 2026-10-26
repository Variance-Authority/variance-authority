# Reviewing `@variance-authority/store`

`store` keeps approved baselines in a directory or under git-LFS behind the
`RasterStore` contract, reads the baseline changelog out of git, and gives
`@variance-authority/core/share` its directory and git line cells.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/store/`.

## Contracts

- **Missing is a pair; anything less throws.** Both halves absent is `null`, a
  new subject; one half alone, a sidecar that does not parse, or an I/O error
  throws, in split roots too. Pinned by [durable.test.ts](src/durable.test.ts) ›
  "refuses an image whose sidecar is missing rather than reporting a new
  subject".
- **Another machine's baseline is found, never compared.** It returns with
  `comparable: false` and the `storedUnder` identity that wrote it. Written in
  [README](README.md#choose-a-backend).
- **Two subjects never share a path.** Keys that render one path, folding case,
  are refused naming both, before any read or write, and across shards by
  `placedFor`; nothing is renumbered. Pinned by
  [path-template.test.ts](src/path-template.test.ts) › "refuses the second,
  naming both, and renumbers neither".
- **A pointer is never an image.** An un-smudged LFS pointer is pulled by its
  own name, and a pull that fails or leaves the pointer throws. Pinned by
  [lfs.test.ts](src/lfs.test.ts) › "refuses an unsmudged pointer instead of
  reporting a missing baseline".
- **What git did not check is said.** `tracking.diagnostics` names every check
  that could not run, `verify: false` included. Pinned by
  [lfs.test.ts](src/lfs.test.ts) › "states that it did not check when it was
  told not to".
- **An empty changelog is an answer only when git read one.** No git, no
  repository or an unresolved `since` is a refusal; a shallow clone, the `limit`
  or an undecodable commit is a `bounded` line. Written in
  [README](README.md#read-why-a-baseline-changed).
- **Concurrent publishes keep both entries.** A line cell replaces its manifest
  only at the version it read; a moved version, a lost lock or a refused push
  writes none and says so. Pinned by
  [share-line.test.ts](src/share-line.test.ts) › "keeps every suite when jobs
  publish at once".
- **The render cache never throws.** A miss and a failure both mean "render it".
  Written in [README](README.md#choose-a-backend).

## Not this package's

- Whether two images differ: `@variance-authority/raster`. The HTTP cell:
  `@variance-authority/core/share`.
