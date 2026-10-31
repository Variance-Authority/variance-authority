---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

`variance index` exits 2 when git cannot read the commit a suite's latest recording ran at, once every line is printed, rather than printing `not prepared` and exiting clean. A recording that names no commit is still an absence and exits 0. `prepareJourneys` reports such a walk as `failed` rather than `unprepared`.

A workstation `variance index` hands the walk to a detached process whose exit status reaches nobody, so that process keeps its lock marked with git's reason, and the next command that reads the follow-ups prints it and exits 2 once it has answered. `--wait` makes the walk before `index` exits, and that exit carries it. Follow-ups a command remakes for a process that ended early exit 2 the same way.
