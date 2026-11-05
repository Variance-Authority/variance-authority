---
'@variance-authority/cli': minor
'@variance-authority/sense': patch
---

`variance carry hand <dir>` reads the share once for a run, and `variance carry receive <dir>` lays that read down in the run's other jobs. Every reader in a job that received answers with that record, however far behind the merge base, and neither the share nor a worktree's primary checkout is asked, so a shard re-run after your mainline moved selects what it selected the first time. `receive` removes the checkout's own record, which would otherwise stand in front of it. `receive` stops the job rather than ask the share when the directory holds no manifest or a record that does not read.

`readMissedMainline`, `writeMissedMainline` and `MissedMainline` are no longer exported: `carry hand` and `carry receive` move that answer themselves.
