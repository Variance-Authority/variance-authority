---
'@variance-authority/cli': patch
'@variance-authority/sense': minor
---

`select --ran-at` runs a test a change the mainline landed and took back reaches

A pull request's check ran on its head merged with the mainline of its day, which may have held a change the mainline landed after the fork. When the mainline then reverted a change, in whole or in part, the net diff from the fork no longer showed it, so a test both the pull request and that change reached was skipped as one only the pull request reached. The mainline's side now also reads every file two or more of its commits since the fork changed as it stood after each of those commits, by its lines or, for an install file, by its packages.

`firstParentChangesBetween(root, from, to)` lists what each commit on `to`'s first-parent line that `from` does not hold changed.
