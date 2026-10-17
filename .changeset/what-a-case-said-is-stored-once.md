---
'@variance-authority/sense': minor
'@variance-authority/cli': patch
'@variance-authority/distill': patch
'@variance-authority/playwright-test': patch
---

What a case said it arranged is stored once, and read the same way everywhere

The record keeps each distinct precondition once, with the cases that said it
as a set in the pool coverage already uses, so a `beforeEach` that every case
of a file runs costs one entry rather than one per case. Every item is kept,
including one a narrower level overrode, and a case's row is resolved when it is
read: per name, the narrowest level wins, two values there are a
contradiction, and a value said at several sites is printed at the first.

Two runs, two shards or two frames of one case now give the same row whichever
arrived first. Before, a value said at two sites could print either site, and a
fraction could print as `0.000001` or `1e-6`, depending on which writer laid
the record.

A record written by an earlier release opens with every case unmeasured: `variance
covering --where` counts them as such until the suite is recorded again.

**Breaking:** on `ExecutionIndex` and `ObservedCase`, a test's `preconditions`
rows are replaced by `said`, the unresolved items as one string; `rowOf(test)`
returns the resolved rows. `encodeExecutionIndex` refuses a test that carries
`said`; `encodeAsSetExecutionIndex` writes it.
