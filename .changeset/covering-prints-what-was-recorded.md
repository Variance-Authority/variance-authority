---
'@variance-authority/cli': patch
---

`covering --where` and `review` name what was recorded

`covering --where` prints `Kept the 2 of 4 cases that covered … and recorded
prices=discounted.`, and `none recorded prices=sale` when it keeps none. A case
recorded without preconditions is counted as `1 case was recorded without
preconditions, so whether it ran under any of that is unmeasured.`; `review`
prints `the state it ran under is unmeasured` for the same case. The refusal on
a record with no preconditions says it was made before preconditions were
recorded, or by a runner that does not record them. Anything that matches on
the old `and said` or `not listened to` text needs the new wording.
