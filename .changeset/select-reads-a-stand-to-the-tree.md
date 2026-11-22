---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance select` charges a test that last ran at an earlier commit only what changed from that commit to the tree. A branch that merges the commit a test last ran at, after a later run on the branch, used to select that test for every file the merge brought in, and to charge a change the test had already run again when the branch edited the same file after the merge. A file the checkout holds exactly as the test ran it now charges nothing. Every change is read to one tree of the working state, written once per selection, and that tree now holds an edit of the same size made in the second the file was staged, which it used to take for the committed text.
