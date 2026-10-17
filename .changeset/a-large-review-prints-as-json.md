---
'@variance-authority/cli': patch
---

`variance review --format json` prints a review too large for one string

Every changed region in a review lists the cases that entered it, so a change that moves most of a suite's regions spells more JSON than V8 holds in one string. `variance review --format json`, and `--out` writing `review.json`, failed on such a change with `RangeError: Invalid string length` and wrote nothing. Both now write the JSON as it serializes, a region at a time, so the answer is never held whole. The text is the same as before.

`--from-run` still reads `review.json` as one string, so it cannot parse a file that large. It now says so and points to the `review.md` the run kept beside it. Before, it said the artifact held no `review.json`.
