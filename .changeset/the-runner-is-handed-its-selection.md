---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
---

A Vitest or Jest configuration wrapped by `withTestSelection` runs only the test
files a change reached when `VARIANCE_AUTHORITY_SINCE` is set:

```bash
VARIANCE_AUTHORITY_SINCE= npx vitest run
```

The runner drops the files the selection skips before it shards, sorts or lists
them: Vitest through a wrapping `sequence.sequencer`, Jest 30 through a `filter`
module chained after the project's own. No path travels through argv, the
environment or a file. Set and empty, the variable reads the base from the
record; set to a ref, that ref is the base when the record names no commit.
`VARIANCE_AUTHORITY_AT_DISTANCE` cuts the selection to a range of import hops,
as `variance select --at-distance` does.

The run prints what it read on stderr: `selected 12 of 672`, `selected none of
672`, or `declined:` and the reason every file runs. A test file the record never
saw runs. Watch mode does not select, nor does Jest under `--filter` or
`--skipFilter`, and each says so. A Vitest run whose selection is empty passes.

The reading is `selectSuite` from `@variance-authority/cli`, the function
`variance select` prints, so the project installs the cli to select.

`variance select --format vitest` and `--format jest` are deprecated, and say so
on stderr: they put the selection on the runner's command line, which a large
one outgrows. They are removed in a later minor release. `--format plain` and
`--format json` stay.
