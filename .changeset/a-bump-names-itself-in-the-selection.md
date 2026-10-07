---
'@variance-authority/cli': patch
---

`variance select` names the lockfile when a bump keeps tests in the run

A package the lockfile resolves differently is walked back to the files that
import it, and those files are read as changed whole. The selection then said
that no skipped test "covered a changed line", named no lockfile and no
package, and a suite that ran in full over a dependency bump looked like a
recording that had stopped narrowing. Now the reason says a test may also have
entered a file the install moved, and a note names the lockfile, the commit it
was compared from, each package it moved with the package it was imported
through (`tinyglobby through vitest`), and the files that import them. A
manifest whose `exports`, `main` or `type` moved is named the same way.
`--format json` gives the lockfile, the packages, the moved manifests and the
count of files under `install`.
`variance review --format json` names the same lockfile under `beyond`.
