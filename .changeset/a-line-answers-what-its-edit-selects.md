---
'@variance-authority/sense': patch
---

`variance covering --line` names every case an edit to that line selects

A line such as `if (observer) {` opens a branch and also holds the condition
the region around it evaluates. `variance select` charged an edit to that line
to both regions. `variance covering --line` read only the branch, so it named
the cases that took the branch and said they were the only ones that could
have reached the line, while every case that evaluated the condition and went
the other way was selected by the edit. `covering` now reads a line by the
rule `select` charges it by when it reads the coverage record, so the two
agree there; `select --execution`, which narrows by recorded journeys, still
charges the branch alone and can select fewer cases. A line that opens a branch or
a function, or closes a function, also answers with the region around it. The brace that
closes a branch also names the cases that took the `else` nobody wrote, which
the recording places on that line. A line inside a branch answers with the
branch alone. `coveringTests`, `coveringTestsInFile` and `testsReaching` answer
the same way, and so do the import hops of `covering --hops` and
`--at-distance`. `testsReaching` asked by a branch path still names only the
tests that took the branch, and it now refuses a `line` given with a
`function`, as `variance covering` already did: the two address a region two
ways.
