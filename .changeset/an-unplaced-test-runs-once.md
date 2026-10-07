---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`atDistance` returns a test with no measured hop count with the one range that
holds the furthest hop the reading measured, or with an open range such as
`3-` when nothing was measured. Ranges that cover every hop without
overlapping, such as `0-2` and `3-`, return each such test once.
`variance select --at-distance` and `VARIANCE_AUTHORITY_AT_DISTANCE` cut their
legs with it, and stderr names the leg that runs those tests.
