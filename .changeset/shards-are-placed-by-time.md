---
'@variance-authority/core': minor
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

`--shard` in Vitest and Jest is placed by recorded time, and `variance shards` says how many to start

A Vitest or Jest config wrapped by `withTestSelection` now places the files of
`--shard k/n` by the time each took on the last recorded run, rather than
leaving the runner to divide them by count. Each shard computes the whole
placement from the same record and keeps its own part: files go longest first
to the shard with the least time so far, and a file the record has not seen is
priced at the median of the ones it has. The run says on stderr which record
placed it and what each shard was given:

```text
variance-authority: shard 1/2 by the times recorded at 8e3b0f0e9028: 1 of 5 files, 9.0 s (shards 400 ms to 9.0 s)
```

When the times cannot be read, the runner's own split runs instead, and the
line says why. A failed read never fails the run. A Jest config that names no
`testSequencer` finds Jest's own through Jest, so a layout that does not hoist
`@jest/test-sequencer`, as pnpm does not, runs as before. Under
`VARIANCE_AUTHORITY_SINCE`, only the files the selection keeps are placed.

`variance shards --setup <seconds>` prints how many shards a recorded suite is
worth, and with `--format json` a `matrix` of `k/n` strings for a CI job to
start. Every shard is charged its setup, so a shard is added only when it
shortens the wait by more than it spends, and the count stops at the slowest
test file, which the answer names with its slowest case. `--budget` asks for
the fewest shards that finish within it, `--workers` divides a shard's share
among its runner's workers, and `--since` leaves out what the change lets the
run skip, so a change that reaches no test answers `0 shards`. `--since` needs
`--collected <file>`, the runner's list of test files, so a test file the
record has not seen is counted, priced at the median. With nothing
recorded it refuses unless `--unrecorded <n>` names the count to start.

`@variance-authority/core/shard` is the placement and the count, which
`variance run --shard` places stories and routes by too.
`@variance-authority/sense` exports `recordedTimes` and `fileCases`, and
`@variance-authority/cli` exports `suiteTimes`.
