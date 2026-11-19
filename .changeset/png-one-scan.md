---
'@variance-authority/png': patch
---

Every diff policy is judged in one scan over the paired rows, instead of a copy of the before image in the after image's order and a `pixelmatch` run for each policy. The counts, the mask and the picture are the ones `pixelmatch` gives, and `pixelmatch` is no longer a runtime dependency.
