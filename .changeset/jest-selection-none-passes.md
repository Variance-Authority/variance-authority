---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A Jest run through `withTestSelection` that found test files and selected none of them exits 0, as a Vitest run does, where it exited 1 and failed a pull request that needed no test. A selected run where no project found a test file still fails as Jest fails, so a `testMatch` that matches nothing stays red. A run with no selection, or under `--watch`, `--filter` or `--skipFilter`, keeps Jest's own exit, and `--watch-all` and `--skip-filter` now count as those flags do.
