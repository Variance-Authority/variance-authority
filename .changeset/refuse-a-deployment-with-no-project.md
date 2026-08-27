---
'@variance-authority/tribunal': patch
---

Refuse a deployment that never said which project it is.

`project` is required, scopes every row and every object key, and had no runtime
check. `undefined` reached D1 as a bind parameter and came back as *the baseline
store could not reach its database or its bucket* — the platform blamed for a
line in a wrangler file — and a blank string quietly became a namespace nobody
named. `createBucketStore` now refuses both with a sentence, which `createTribunal`
and `createReviewStore` inherit, the way the two token rules already answer.
