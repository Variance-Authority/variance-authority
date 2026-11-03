---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

`variance review` reports where a run's loads drifted from the walk against the mainline's record: each load a test file's imports and the suite's `before` files do not reach, grown or shrunk since the baseline, with the test file and the loaded file. The baseline is the mainline's record read against the merge base's walk, from the `before` the merge base declares, and a record at another mainline commit stands in when the commits between touch nothing the walk reads, declare the same `before` and install the same packages. A change that edits a manifest, a workspace or a `tsconfig*.json`, or a checkout that moved a walked file after its runs, is named as not checked. A row is an observed load, not a failure. `unreachedLoads` is `driftFromWalk`, and a `__mocks__` file is no longer exempt by its path.
