---
"@variance-authority/sense": patch
---

A Vitest run started with `--reporter` records

A command-line `--reporter` replaces the configured reporters, and an editor that runs a test from the gutter passes its own. `withTestSelection` now folds such a run when its server closes, from what its case runner wrote, so the record and the case index are written as for any other run. A project with its own `runner` is told the run recorded nothing, instead of getting no record and no message.
