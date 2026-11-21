---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`variance select` charges a test that last ran at an earlier commit only what changed from that commit to the tree. A branch that merges the commit a test last ran at, after a later run on the branch, used to select that test for every file the merge brought in, and to charge a change the test had already run again when the branch edited the same file after the merge. A file the checkout holds exactly as the test ran it now charges nothing.
