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
rule `select` charges it by, so the two agree: a line that opens a branch, or
closes a function, also answers with the region around it, and a line inside a
branch answers with the branch alone. `coveringTests`, `coveringTestsInFile`
and `testsReaching` answer the same way, and so do the import hops of
`covering --hops` and `--at-distance`.
