# @variance-authority/store

## 0.1.1

### Patch Changes

  - @variance-authority/raster@0.1.1
  - @variance-authority/report@0.1.1

## 0.1.0

### Patch Changes

- 5c3299b: Ask `git log` about the baseline root the caller named. A relative `root` was
  passed to git as a pathspec and read back against the directory git ran in —
  which defaults to that same root — so `readChangelog({ root: '.variance/baselines' })`
  filtered on `.variance/baselines/.variance/baselines` and returned no commits.
  An empty list is this reader's word for *no baseline has ever been explained*.
