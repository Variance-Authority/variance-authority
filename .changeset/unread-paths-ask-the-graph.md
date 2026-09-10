---
'@variance-authority/sense': minor
'@variance-authority/cli': patch
---

A changed file no probe can sit in is asked of the module that imports it.

The record decides what a change reaches. A module nobody executed — every
test that imports it mocks it, or nothing loaded it — has no row, and the tests
that import it never ran a line of it: it selects nobody, and so does everything
only it imports. A stylesheet, an image, a JSON file can hold no probe, so it
never has a row, and whether a test ran it is a question about the module that
imported it. `narrowByExecution` and `selectTestFiles` now take `relations` and
walk from every changed file through `asset` edges — the stylesheets that import
the stylesheet, the modules that import those, and no further — and select the
tests that entered each module reached; a module reached without a row is dead.
A file whose own edges the scan could not read may reach the asset by an edge
nobody saw, so its tests are selected as well. `knownAs` looks the changed file
and every module reached up under every name the journal holds them by. `unread`
names the changed paths nothing recorded holds — no row, no precondition, no
place in the graph — as a report rather than a widening: a suite that depends on
a file that way declares it as a precondition.

A diff is read the way `git` writes it. A pure insertion is placed after the
line it follows, additions past the count of lines they replace are charged to
the gap they open after the last one, a file the diff names without a hunk — a
binary, a rename, a mode change — is charged whole, a quoted path is decoded,
and the narrowest region on a changed line is measured over regions that have
source, so the `else` nobody wrote never decides a line alone. A module the
runner evaluates again after a registry reset keeps what it counted before it,
a module a runner shares across files without isolation is counted for every
file that consumed it, and what a module did while evaluating is credited to
the files that entered it rather than to every file the run ran; a file that
only reads a module another file evaluated is reached through `relations`. A line that
opens or closes the narrowest region — the condition of an `if`, the props
beside a one-line handler — is the enclosing region's line too, and charges it.

The CLI's `--since` lists files from the merge base of the ref and `HEAD` to
the working tree, untracked files included, so a branch behind `main` is not
charged with what others merged and a watch loop is asked about the edit that
was just saved; the hunks the journal reads are taken from the commit the index
was recorded at, whose coordinates are the only ones its line ranges are in;
a module the run did not load, carried from an earlier recording, has its text
on disk compared with what its rows were recorded over, and every test that
entered a module that has moved is marked partial rather than left standing on
lines that are no longer there. A rename's hunks are read under the old name.
Paths are read unquoted and under `a/` and `b/` whatever the operator's git
configuration says, and the index is looked for at the repository root as well
as the run's directory.

The Jest seam instruments every project of a `projects` configuration and
leaves a setup entry that names a package out of the preconditions; the Vitest
seam does the same for its setup entries.

The runtime's counter factory is installed before the project's own setup
files — first in Vitest's `setupFiles`, and in Jest's `setupFiles` rather than
`setupFilesAfterEnv` — so a setup file that loads an instrumented module finds
it. Jest projects that name `@variance-authority/sense/jest-setup` by hand keep
working; it installs the factory itself when nothing has.

Every selection now says why. `because` names, per selected test, the changed
region it entered, the precondition it is governed by, or the trail of importers
it was found through. The CLI's `--since` hands its `relations` scan to the
journal reader when the config asks for one.
