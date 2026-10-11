---
'@variance-authority/cli': minor
'@variance-authority/distill': minor
'@variance-authority/sense': minor
---

Distill writes a row a test file

`variance distill --format jsonl` writes the scope reading one line a test file:
its suite, its `cases`, what it `loaded` (modules that declare a function, and
their lines), and of that what no case of it entered as `unentered`, or
`withheld` with the reason. A suite that kept no record is named on stderr.
`--test` and `--file` refuse it. `scopeRows` from `@variance-authority/distill`
yields the same rows, and `FileDistillation.lines` sums the lines of what a file
loaded.

A script that reads a record too large to decode reads it with the CLI's own
readers: `recordedExecutionFile` from `@variance-authority/cli` names the record
`distill` and `covering` read, and `@variance-authority/sense/test-selection`
exports `openSetColumns` with its `SetColumns`, `TestColumns` and `StringTable`
types for the case index, and `BLOCK_KINDS` for the region kinds of an opened
snapshot.
