---
'@variance-authority/playwright-test': patch
---

An in-place capture retries when the subject changed during its screenshots, even if it changed back

The two reads around an in-place capture's screenshots could agree while the
screenshots held a state neither read saw: a text swapped and restored between
them. The page now records every change to the subject between the two reads,
outside `data-variance-ignore` regions; any change counts as movement, and the
refusal names what changed. A write that sets an attribute or a text to the
value it already holds is not a change.

This counts changes the compared reading never shows. An attribute the reading
drops, or a node it does not keep, that a timer rewrites with a new value on
every tick now spends a `settleAttempts` round each time, and fails the subject
when every round sees it. Put `data-variance-ignore` on that region.
