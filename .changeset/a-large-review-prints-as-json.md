---
'@variance-authority/cli': patch
---

`variance review --format json` prints a review too large for one string

Every changed region in a review lists the cases that entered it, so a change that moves most of a suite's regions spells more JSON than V8 holds in one string. `variance review --format json`, `--out`'s `review.json` and `--from-run --format json` failed on such a change with `RangeError: Invalid string length` and printed nothing. They now write the JSON as it serializes, a batch at a time, so the answer is never held whole. The text is the same as before.
