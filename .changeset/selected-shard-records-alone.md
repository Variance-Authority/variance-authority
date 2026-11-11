---
'@variance-authority/sense': patch
---

A shard of a selected run now records the test files it ran and nothing else, as a shard of a whole run does, so `variance share` folds the parts over the base and a test file no shard ran keeps the row it had. Before, a selected shard laid its run over the base it was seeded with, so two shards each carried the other's base rows and the fold refused them.

An upgrader does nothing: a run that is not sharded records as before, and a `share` that folds shards reads the new records as it reads a whole run's.
