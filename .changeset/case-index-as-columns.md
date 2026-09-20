---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
'@variance-authority/playwright-test': minor
---

The per-case execution index is columns, and fits a CI artifact limit

`cases: true` wrote its index as JSON, one object per crossing. On three real
projects that measured 31 to 37 bytes per crossing: a suite whose snapshot is
0.3 MB left a 27.2 MB file beside it, and every CI has a cap on what a job may
upload.

It goes through the same column codec the snapshot uses — a dictionary, parallel
integer columns, zstd run coding — and the same three projects now write 0.46 MB,
0.46 MB and 0.21 MB. Nothing about the model changed: `decodeExecutionIndex`
returns the index `encodeExecutionIndex` was handed, field for field, and the
optional `loaded` keeps the difference between unsaid and denied.

The default path is `<coverage file>.cases.bin`. An `executionFile` you name
`.json` is still written as JSON, at the size JSON costs, for a reader that has
to have it — and `variance covering` and `variance distill` read either, telling
them apart by the first byte, so a cache recorded before this still answers.
