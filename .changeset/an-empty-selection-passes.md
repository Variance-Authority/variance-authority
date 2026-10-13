---
'@variance-authority/sense': patch
---

A Vitest 3 or 4 run that the selection leaves nothing to run passes

Under Vitest 3 and 4, a run handed a selection that skipped every file printed
`selected none of M` and then *No test files found, exiting with code 1*, so a
pull request that reached no test, a README edit for one, failed its test job.
A `--shard` that the selection left no file to run failed the same way. The
seam now sets `passWithNoTests` for that run when the selection dropped files
and left it none, and the run exits 0. A run that drops nothing keeps the
project's own setting, and Vitest 2, which never failed here, is unchanged.
