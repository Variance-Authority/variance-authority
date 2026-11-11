---
'@variance-authority/sense': patch
'@variance-authority/cli': minor
---

A Vitest or Jest shard of a selected run now records the test files it ran and nothing else, as a shard of a whole run does: it lays no base under its run, selects from the record it was handed, and a shard that runs no file leaves no record. A shard that runs in passes, such as near tests and then far ones, selects and places each pass from the record it was handed, beneath what its earlier passes ran, so a later pass neither re-runs nor skips what the first one decided. `variance share` folds the parts over that record, and a test file or case no shard ran keeps the row it had. Before, a selected shard laid its run over the base it was seeded with, so two shards each carried the other's base rows and the fold refused them.

`variance carry take <dir> --as-base` lays a pull request's last push where `carry receive` laid the mainline's read, for a shard: it selects from the record the plan counted, and its own record still holds only what it runs. It refuses to run before `carry receive`.

An upgrader whose shards carry a pull request's last push adds `--as-base` to the shards' `carry take`. A run that is not sharded records as before, and a `share` that folds shards reads the new records as it reads a whole run's.

The Jest selection reporter no longer reads a `selected` option. `withTestSelection` set it to tell a selected run's shards from a whole run's, and they now record the same way; a config that passes it by hand can drop it.
