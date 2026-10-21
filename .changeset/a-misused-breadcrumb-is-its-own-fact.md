---
'@variance-authority/event': patch
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A `varianceBreadcrumb` call whose dimension or key makes no `dimension:key` — not a non-empty string, or a dimension holding `:` — is recorded as a misuse, a fact of its own beside what the case said and what the code read, and never as a read. It was recorded as a read named `:<dimension>:<key>`, which `covering --read` and `review`'s split treated as a key. A misuse is kept once per argument and value given, at its first site, as a read is once per key and value. `covering` prints `misused varianceBreadcrumb at <site>: the key 7 is not a string` after the reads, `review` names it after a region's split by what the code read with the number of cases that met it, and `review --format json` gives the case `misused: [{argument, value, site, level}]`, an array or an object given by its kind alone.
