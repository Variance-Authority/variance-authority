---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`variance index` exits 2 when git cannot read the commit a suite's latest recording ran at, once every line is printed, rather than printing `not prepared` and exiting clean. A recording that names no commit is still an absence and exits 0. `prepareJourneys` reports such a walk as `failed` rather than `unprepared`.
