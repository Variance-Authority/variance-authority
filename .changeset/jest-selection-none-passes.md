---
'@variance-authority/sense': patch
---

A Jest run through `withTestSelection` that selects no test file exits 0, as a Vitest run does, where it exited 1 and failed a pull request that needed no test. A run that selects now takes `passWithNoTests` unless your configuration sets it. Jest fixes that setting before it finds any file, so a selected run that finds no file at all also exits 0. A run with no selection, or under `--watch`, `--filter` or `--skipFilter`, keeps Jest's own exit.
