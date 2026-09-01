---
'@variance-authority/sense': minor
---

Stamp the coverage index with the commit it was recorded at, and read the module
row that says the build never parsed a file.

There is one master branch; every other checkout is that branch plus a diff, or
minus one where it is behind. So the index now carries one field — the commit it
stands at — and the distance from it is `git diff` and the working tree. Nothing
is walked, nothing is scored, and a recording made outside a checkout carries no
commit, which is the honest record of an index that cannot say where it is.

`instrumented: false` was written to disk and read by nobody at selection time. A
module the build could not parse has no blocks, so a changed line inside one
selected the empty set and returned it as an answer — a subject that entered the
file was skipped on the strength of a measurement that was never taken. That row
is now read as the silence it is: the file comes back under `unread`, and
selection widens the way the shape of the column always promised.

Recording no longer refuses when the index it is about to write over cannot be
decoded. That read happens under the index lock inside a runner's teardown, and
refusing there stopped every later run from recording anything until somebody
deleted the file by hand.
