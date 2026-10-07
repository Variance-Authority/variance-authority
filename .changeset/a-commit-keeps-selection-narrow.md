---
'@variance-authority/sense': minor
'@variance-authority/cli': patch
---

A commit between partial runs no longer widens the selection to every test of a changed file

A test a partial run leaves out stands at the commit it last ran at. What
changed between that commit and the record's was charged whole for it, so one
commit made between two runs selected every test that loaded a file it touched,
whatever the edit was. In this repository, two committed edits to `columns.ts`
with a partial run between them selected 291 of the unit suite's 678 test files.
They now select the 4 that entered the regions the edits changed.

`variance select` and `askPerStand` now read that change from both texts, the
way a change in the tree is read. The record's text is the old side, so the
change lands on the regions the test's rows hold. A test still runs for an edit
to a region it entered, and no longer for one elsewhere in the same file. The
merge base with a ref named on purpose is still read whole.

`Stand` gains `changed`, every file changed from the stand to the record's
commit. `whole` holds only what a stand charges whole, and is empty for a stand
the runs recorded. `askPerStand` hands its selector a `StandQuestion` in place
of the files to charge whole and the stand's commit, so a selector passed to it
is rewritten to read the question; `standDiff` writes the change a `stand`
question reads.
