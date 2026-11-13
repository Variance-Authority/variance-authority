---
'@variance-authority/cli': patch
'@variance-authority/sense': minor
---

`select --ran-at` runs a test a change the mainline landed and took back reaches

A pull request's check ran on its head merged with the mainline of its day. When the mainline later reverted a change, in whole or in part, the net diff from the fork no longer showed it, so a test both the pull request and that change reached was skipped as one only the pull request reached. The mainline's side now reads every file two or more of its commits since the fork changed as changed whole, and selects as without `--ran-at` when such a file is an install file.

`firstParentChangesBetween(root, from, to)` lists what each commit on `to`'s first-parent line that `from` does not hold changed.
