---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

A record without coverage

A run that keeps its cases and instruments no module writes `coverage.bin` with
its case sections and none of the coverage sections. A record already at the
path keeps its coverage as it was, under the new run's cases; a run that keeps
no cases and instruments nothing writes nothing. A file it could not finish
measuring is still recorded incomplete, which selects it. Its warning now says
the run recorded no coverage and narrows no later selection.

Such a record is unmeasured, not a record of tests that reach nothing.
`readTestCoverage` refuses it with `RecordWithoutCoverage`, and selection
narrows nothing over it: `variance select` skips nothing and says the record
holds no coverage, `variance run --since` runs every test file, and
`variance journeys` carries no partings, and `yarn test:since` runs the whole
slice and says why. Landing shards with `variance journeys` folds them over no
coverage and keeps the record's cases; a shard that holds cases and no coverage folds
nothing and lands its cases, and landed where no coverage stands it writes a
record of cases and no coverage. A worktree seeds from such a record, and a
fetched mainline record of that kind is laid, with its cases and no runs
record. A record that holds some coverage
sections and not the others is still refused as broken.

`recordOfCases` writes a record from case sections alone, and
`withoutCoverage` answers from a record's header whether it holds no coverage.
