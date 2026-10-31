# ADR-0099 — The edit loop is the recipe we publish

**Status:** accepted
**Date:** 2026-10-28
**Supersedes:**
[ADR-0096](0096-the-edit-loop-answers-for-one-edit.md)'s decision 2 (one
reading by the script, gated by `kept`) and decision 5 (a script, not a
`variance` command). Its slice, its range, its compiler step and its "no marker
of its own" stand.

## Context

`yarn test:loop` was a script under `tools/`: it read the unit selection by
calling `selectSuite` and `kept` from `dist/`, listed the unit test files
through `tools/slices.mjs`, and started Vitest only when a file was kept. The
reason was a runner boot, 0.55–0.8 s, paid to learn that nothing runs.

That made the loop we run the one thing about our own workflow nobody else can
copy. `docs/test-an-edit.md` tells a user that no script sits between them and
the runner; ours did, built on internals, and it said nothing about what it
selected beyond the seam's own line.

Measured at `3df187ed8` on the measurement machine, under a load average of
10–13 on 16 cores, median of five runs each, the plain form
`tsc --build && VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=0-1 vitest run`
takes 0.73 s when the edit keeps no test, against 1.1 s for the script; 1.42 s
when a body edit keeps one test; 0.09 s to a type error, exit 2. The boot the
script avoided costs less than the script's own `variance index` and imports.
An empty selection exits 0 and prints `selected none of 1002` with the reading's
notes.

## Decision

**`yarn test:loop` is the command a user would write:
`tsc --build && VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=0-1 vitest run`.**
The default Vitest configuration is the unit slice, so the slice needs no
argument. The script, its check and `inSlice` are deleted.

Why a selection kept what it kept is asked of `variance select --suite unit
--at-distance 0-1`, which already names the change it read, the hops it found
and the regions it charged. The loop does not print it on every run.

The selection still loads from the `dist/` that `tsc --build` just wrote: the
configuration imports the seam through the package's exports.

## Consequences

The loop is published as a section of `docs/test-an-edit.md`, and what we run
is what that page says. A user's loop and ours are the same three steps.

The seam computes the selection inside the runner, so an empty selection pays
the Vitest boot. At 0.73 s that is accepted; a selection read outside the
runner to save it would be the second implementation this ADR removes.

The script ran `variance index` before it read; the line does not. A wrapped
run writes the source index when it finishes, so each selection reads the file
graph the previous run left. A file new since then is missing from that graph,
and the run names it among the changed files it holds nothing about. No test is
lost by it: a new file is reached only through an import an edit added, and
that edited importer charges every test that loaded it. Checked by adding a new
module and its import, then reading the loop and `variance select` after it.

## Amended 2026-10-31 — a reader updates an index older than its question

The consequence above does not hold: no run writes the source index, so the
graph a selection reads is the last `variance index`, whatever ran since. A
file added after it had no hops, and the test that imports it was placed only
in the open leg. An edit to the new file alone then selected nothing at `0-1`
([#777](https://github.com/Variance-Authority/variance-authority/issues/777)).

The line stays as published. The selection asks the published index for the
files the diff changed, and on a workstation an index that lacks one the
checkout holds is updated once, with a line on stderr, as a missing one is. CI
reads its index as published: the pipeline's step ran over that checkout. A
file added since the index that the diff does not change still has no hops
until the next `variance index`: a test that reaches an edited file only
through it stays in the open leg.

`yarn test:loop` hands its arguments to the runner and reads its leg from
`VARIANCE_AUTHORITY_AT_DISTANCE`, `0-1` when unset; the waves keep
their fixed legs, since a gate stamped for a leg must have run it. A flag
Vitest does not take fails before any test runs, where it used to reach
`tools/needs.mjs` unread
([#855](https://github.com/Variance-Authority/variance-authority/issues/855));
the leg's notes under a seam name the variable, which is how the same run asks
for another leg.

## Amended 2026-10-28 — a green run ends with what a new function needs

After the tests pass, the loop prints the existing functions that need what
each function new on the branch needs, in the package sources, the scripts a
package ships and `tools/`, for functions with five needs or more
(`tools/needs.mjs`, [journal 0077](../journal/0077-a-copy-keeps-what-it-needs.md)).
A second implementation is cheapest to drop while it is being written, and the
loop is the one thing an agent runs then.

The list is advice. It never changes the exit code, and what keeps it from
being read, no merge base with `origin/main` among them, is one line in its
place. It is the third step of the script line, `node tools/needs.mjs`, after
the compiler and the runner, so it reads the `dist/` they built, and a red
compiler or a red test still ends the run before it: a red run is the agent's
next edit, and the list waits for the green one. The two steps before it stay
the line `docs/test-an-edit.md` publishes; the list is ours, a reader of this
repository's own history, and the page does not carry it. On the measurement
machine, reading it alone takes 0.56 s with its cache warm and 1.5 s on the
first run after the reader changes, Node's start included.
