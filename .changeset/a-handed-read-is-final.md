---
'@variance-authority/cli': minor
'@variance-authority/sense': patch
---

`variance carry hand <dir>` reads the share once for a run, and `variance carry receive <dir>` lays that read down in the run's other jobs. Every reader in a job that received answers with that record, however far behind the merge base, and the share is not asked, so a shard re-run after your mainline moved selects what it selected the first time. `receive` stops the job rather than ask the share when the directory holds no manifest or a record that does not read.

`readMissedMainline`, `writeMissedMainline` and `MissedMainline` are no longer exported: `carry hand` and `carry receive` move that answer themselves.
