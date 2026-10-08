---
'@variance-authority/sense': patch
---

A shard of a run that selects nothing records the files it ran and nothing else

A Vitest or Jest shard places its files by the times the mainline's record
holds, and reading them can fetch that record into the shard's cache. The fold
then laid it under the shard's run, so every shard's record held every test
file of the mainline, and `variance journeys` refused to fold them: a test file
belongs to one shard. A shard of a run that selects nothing now lands on no
base, so the shards fold over the base as one unsharded run would have landed.
A selected shard still records over the base its selection was cut from.
