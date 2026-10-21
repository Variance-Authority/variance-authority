---
'@variance-authority/event': patch
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A `varianceBreadcrumb` call whose dimension or key makes no `dimension:key` — not a non-empty string, or a dimension holding `:` — is recorded as a misuse, with its site and what was wrong, and never as a read. It was recorded as a read named `:<dimension>:<key>`, which `covering --read` and `review`'s split treated as a key. A misuse is kept once per site and reason. `covering` prints `misused varianceBreadcrumb at <site>: the key 7 is not a string` after the reads, `review` names it after a region's split by what the code read with the number of cases that met it, and both give the case `misused: [{site, why}]` under `--format json`. `covering --format json` now gives each test `preconditions`, `reads` and `misused` in place of the recorded `said` text.
