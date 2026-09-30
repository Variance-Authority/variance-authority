---
"@variance-authority/cli": minor
---

`variance share --suite <name>` reads one suite's execution record from its mainline, or with `--publish` publishes it to the line the run belongs to, taking the suite and the share from the root `variance.config.json`, so a repository with no visual project and no run report can share its unit suite's record. `suiteBase` answers which record a runner of your own measures a change from: the checkout's own, else the mainline's, else, in a worktree that has recorded nothing, the primary checkout's as an offline fallback, with `missed` saying why the mainline's was not read. `layMainline` lays the mainline's record into the checkout's own layer with a runs record of one full run at the published commit, and `mainlineRuns`, `mainlineRead` and `mainlineMissed` are exported beside them.
