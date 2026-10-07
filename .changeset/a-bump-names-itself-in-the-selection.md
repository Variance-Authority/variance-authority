---
'@variance-authority/cli': patch
---

`variance select` compares the install from the one the suite ran on, and names the lockfile when a bump keeps tests in the run

A suite recorded over a lockfile you had not committed yet was compared from the
lockfile at the journal's commit, so the bump the suite had already run on was
read as a change, and selecting with nothing edited ran every test that loads
the bumped packages: `skipping 0 of 198`. The comparison now starts from the
install the recording kept, so the same selection skips the whole recorded
suite, and a lockfile or manifest you change after recording, or undo, is
compared from the recorded one. Tests a later run leaves where they last ran
are compared from the install they ran on too, so committing the bump and
running the selection does not put them back in the run. A recording that kept
no install is compared from its commit as before; one whose kept texts this
cache does not hold is compared from its commit too, and a note says so for each
commit it happened at. A suite that ran with its lockfile deleted is no longer
said to be missing it from the commit: the note says the suite ran without one.

A package the lockfile resolves differently is walked back to the files that
import it, and those files are read as changed whole. The selection then said
that no skipped test "covered a changed line", named no lockfile and no
package, and a suite that ran in full over a dependency bump looked like a
recording that had stopped narrowing. Now the reason says a test may also have
entered a file the install moved, and a note names the lockfile, where it was
compared from, each package it moved with the package most of its files
imported it through (`tinyglobby through vitest`), and the files that import
them. A manifest whose `name`, `exports`, `main` or `type` moved is named the
same way. `variance select --format json` gives the lockfile, the packages, the
moved manifests and the count of files under `install`.
`variance review --format json` names the same lockfile under `beyond`.
