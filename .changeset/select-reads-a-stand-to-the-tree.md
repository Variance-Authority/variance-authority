---
'@variance-authority/cli': patch
---

`variance select` no longer charges a test for a file the checkout holds exactly as it was where that test last ran. A branch that merges the commit a test last ran at, after a later run on the branch, used to select that test for every file the merge brought in.
