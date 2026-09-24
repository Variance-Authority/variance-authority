# Spec 0068 — an edit runs what it reaches, from the editor

**Missing:** an editor that runs tests as you work. Wallaby's defining trait is
that the marks are never older than the last edit. Here, the record is as old as
the last `yarn test`. `test:since` already selects the tests an edit reaches,
nearest first. Nothing starts it from an editor, streams its outcomes back, or
folds the run into the record the editor is painting from.
**Built on:** the selection behind `tools/test-since.mjs` and
`variance select --format vitest|jest`, the distance grouping in
`packages/sense/src/test-selection/at-distance.ts`,
[0063](0063-an-editor-asks-about-the-text-it-holds.md) (the reader and its
`changed` signal), [0067](0067-a-case-carries-its-outcome.md) (outcomes in the
record), [ADR-0043](../context/adr/0043-an-extension-does-not-own-its-host.md).

## Purpose

Wallaby owns its runner. We will not: the project's runner, its config and its
seam are what produced the record, and a second runner would produce a second
record that disagrees with the first. What we add is the part Wallaby has to
guess at, **which tests to run**. The selection is measured, carries a reason
for every test, and orders tests by how many imports separate them from the
edit.

## What would discharge it

**1. A save runs the near end.** On save, the reader's `change` facet already
names the tests the edit reaches and their distance. The editor asks the reader
to run them through the project's own runner with its seam loaded. It runs
`0-2` first and the rest after, which is the loop `AGENTS.md` describes, with
the editor as the one pressing the key. `--at-distance` is a setting, and it
defaults to the whole selection in two legs.

**2. The run is the project's run.** The command is the project's own test
script with the selection passed as the runner's file filter
(`--format vitest` and `--format jest` already print it). The run's recording
layers over the snapshot the way every `yarn test` does, so after it the reader
answers from the new record and sends `changed`. Nothing writes a record the
project's own run would not have written.

**3. Outcomes stream while it runs.** The seam's reporter writes each case's
outcome (0067) as it finishes. The reader forwards those as
`{"ran": "t41", "outcome": "fail", …}` lines, so a gutter turns red before the
file's run ends. A case the run selected and has not reached yet is `queued`,
which is a state the editor draws.

**4. An unsaved buffer is not run.** The runner reads the disk. Running the
buffer means writing it somewhere the runner will read it, or patching the
runner's file system. Both are operations the user did not ask for, in a place
they would not look. So a dirty buffer shows the reading and the selection (what
the edit is and what it would run), and runs on save. This is a position. It is
reversible only through a runner that accepts a module's text as input, and that
has to be the runner's own interface.

**5. What was not run is said.** A run that stops at the first leg leaves the
tests further out, and the ones the reading could not place. The editor shows
that count and the command that runs them. A selection that widened to the whole
suite says why, in the words `test:since` already prints, and the editor asks
before starting it.

**6. One run at a time.** A save during a run cancels the run's queue after the
case in flight and starts a new selection. A case that finished keeps its
outcome. A case cancelled before it ran is not reported as passed or failed.

## What it deliberately does not do

It does not run on a timer or on focus. A run is caused by a save, and the user
can see which save caused it.
