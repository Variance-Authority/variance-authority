---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

A worktree is not seeded from a record its runs cannot be laid over

A new worktree's first record of a suite was copied from the mainline record
last fetched on this machine, or else from the primary checkout's, whenever this
build could open it. A record written under other probes opens, but no run of
this build can be laid over it. So every run in the worktree failed with "this
run cannot be laid over the record", and deleting the copy did not help: the
next run copied it again. Now a base written under other probes than the run's
is passed over for the next one, and the run prints which record it skipped,
the probes it was written under, and the probes the run records under. When
every base is skipped, the run starts the worktree's record from nothing.

**Breaking:** `seedTestCoverage(file, root, instrumentation, cacheRoot?)` takes
the probes of the run about to land as its third argument, before `cacheRoot`.
Pass `undefined` for a landing that lays no coverage, which can be laid over a
base under any probes. `Seeded` gains `from: 'nothing'`, and the `primary`
variant can carry `passed`, the mainline record it skipped. Each skipped record
is a `PassedOver`: `{ file, instrumentation, run }`.
