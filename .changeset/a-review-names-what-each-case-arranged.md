---
'@variance-authority/cli': minor
---

A review names what each case arranged

The markdown `variance review` writes lists, under each changed function a case
ran, every case with the preconditions it said, in the form `covering` prints:
`flag=ff-on (src/checkout/total.test.ts:31)`. When those cases said more than
one value of a name, the function's line names every value: `ran under
flag=ff-off, flag=ff-on`. A record made before cases said anything says what
they arranged is unmeasured, and cases nobody listened to are counted apart
from the cases that said nothing. `ReviewCase.preconditions` carries them in
`review.json`.

`variance covering --where` that keeps none of the cases that covered a line or
function says the filter left none of them, and how many there were, rather
than that no named test covered it. `CoveringWhere.ran` holds that count.
