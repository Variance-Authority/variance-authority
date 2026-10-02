---
"@variance-authority/sense": patch
---

A run whose workers stage what they recorded now folds their contributions in the order they were written, every run. The fold used to read them in the order of random file names, so the same run could merge a retry before the attempt it retried on one run and after it on the next, and the heads it reported came out in a different order each time.
