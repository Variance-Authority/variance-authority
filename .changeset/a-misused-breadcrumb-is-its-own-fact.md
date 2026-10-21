---
'@variance-authority/event': patch
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A `varianceBreadcrumb` call whose dimension or key makes no `dimension:key` — not a non-empty string, or a dimension holding `:` — is recorded as a misuse, with its site and what was wrong, and never as a read. It was recorded as a read named `:<dimension>:<key>`, which `covering --read` and `review`'s split treated as a key. `covering` prints `misused varianceBreadcrumb at <site>: the key 7 is not a string` after the reads, and `review.json` gives the case `misused: [{site, why}]`.
