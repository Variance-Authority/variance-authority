---
'@variance-authority/sense': major
'@variance-authority/playwright-test': patch
'@variance-authority/storybook-collector': patch
---

The checkout says what the probes meant: no build writes module records

A probe names the file it was placed on and the digest of that text,
`path@digest`. When a run is folded, each module the journals name is cut again
from the file in the checkout. A file whose text still matches is read on its
own regions; a file that has moved on since the build reads as one whose reach
is not known, which selects every test that entered it; a file that is gone
counts the same way. Nothing is written beside the build, and nothing under the
cache's `test-selection/<key>/<label>/` is read.

Breaking:

- `testSelectionProbes()` takes no `cacheRoot`. Its `label` names the journey
  head and nothing else.
- `recordExecution()` takes no `label` and no `heads`.
- The Jest journeys options (`withJourneyCoverage`) take no `heads`.
- `jestStore` is removed from `@variance-authority/sense/jest`.
- `instrumentModule(code, file)` takes no options: call it first, on the file as
  it is on disk.
- A journal names a module by `path@digest`. A driver that writes its own
  journal builds the id with `moduleId(path, code)` from
  `@variance-authority/sense/journal`.
