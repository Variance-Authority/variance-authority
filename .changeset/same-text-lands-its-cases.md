---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A shard that cut unchanged text differently keeps every other file's cases

When you land shards with `variance journeys --suite`, or a runner lands a run
into its record, a module the run recorded from the same source text as the
record keeps the cases the record held for it, by address, as its coverage rows
already did. Before this fix, the cases were dropped wherever the two cuts
numbered a site's seats differently. The same text is cut differently when a run
reads a file through both its source and its build: that run keeps only the
regions both readings cut alike, such as a multi-line `await`. The dropped cases
belonged to test files the shard never ran. CI's coverage comment then reported
hundreds of regions as having lost every case on a pull request that did not
touch those files.

When the texts differ, or one side's text is not known, the numbering still
decides, as before. `landCases` and `layCases` take the text each held module
was cut from as a new last argument, which `textsOf(coverage)` builds. A run's
`modules` on `LaidRun` give its own texts, and `CaseRunFiles.sameText` passes
the answer to `layerCaseIndex`.
