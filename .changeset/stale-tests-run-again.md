---
'@variance-authority/sense': patch
---

A layered run no longer turns a test's *entered this region* into *did not*.

A subset run — one file by hand, a watch loop — layered over a full one
positions the index where the subset stands and drops the crossings of every
test it did not re-record on every region it rewrote, while still calling those
tests whole. The next diff of such a region then skipped the one test known to
have reached it. `mergeCoverage` now carries such a test incomplete: it runs at
the next selection regardless of what changed, and that run records it whole.
