---
'@variance-authority/sense': minor
---

Rstest leaves out the test files a change did not reach

`withTestSelection` from `@variance-authority/sense/rstest` now reads `VARIANCE_AUTHORITY_SINCE` and `VARIANCE_AUTHORITY_AT_DISTANCE` as the Vitest and Jest wraps do: the files the selection skips join the project's `exclude` before Rstest plans its entries, stderr says `selected N of M`, and a selection that keeps no file runs none and passes. `VARIANCE_AUTHORITY_GRAIN=case` fails the run, since Rstest runs a kept file whole.
