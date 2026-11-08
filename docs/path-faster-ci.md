# Make CI faster

A suite that takes too long in CI gets faster in four steps, and each one
builds on the one before: split it across jobs by time, run only the tests a
change reached, and let each next push run only what it changed. The fourth
step brings the same selection to the loop you or your coding agent run on your
own machine after every edit, so less is left for CI to catch. All four read one
record that your main branch's full run writes, so wiring the first step
prepares the rest.

[Variance Authority](README.md) keeps that record on the suite you already run.
This page orders the steps and links the page that owns each one; read a step's
page when you reach it.

## 1. Split the suite across CI jobs by time

`--shard k/n` normally deals out test files by count, so one shard gets the slow
ones and the run waits for it. Wrap the Vitest, Jest or Playwright config with
`withTestSelection` and each shard takes whole files by how long they took on
the last recorded run, so the shards finish close together. No test is skipped
yet: this step only removes the wait for the slowest shard.

The wrap is also what records. Every wrapped run writes the record, and main's
full run saves it to the CI cache for pull requests to restore. With no record
to read, every test file runs, and that run writes the first one. A suite that runs in a single
job keeps the wrap and leaves out `--shard`.

[Split a suite across CI jobs](sharding.md), and
[the CI cache workflow](cache.md#in-ci) for where main's record is saved.

## 2. Run only the tests a change reached

A pull request then reads the record main saved and leaves out every test file
that ran none of the changed code. The selection reads which lines each test
covered, not which files import which, so a one-line edit to a shared module
runs the few tests that executed that line. When the record leaves a doubt,
the run either widens or stops, and says which doubt it was.

[Coverage-based test selection](coverage-test-selection.md) says why this
selects less than an import graph. [How test selection works](selecting.md)
sets it up in CI, and [What a skipped test promises](selection-safety.md) says
exactly when a test is left out.

## 3. Let the next push run only what it changed

Each push to a pull request lands on a fresh CI machine, so measured from main's
record it reruns the whole change, and a one-line fix costs as much as the push
before it. Run `variance carry keep` after the tests, red or green, and the
pull request's cache saves the record that push wrote. Run `variance carry take`
before the tests on the next push, and it lays that record over main's, so the
push runs what changed since the last one and every test file that one did not
finish green.

[A pull request's next push](selecting.md#a-pull-requests-next-push)

## 4. Give the edit loop the same answer

The same selection runs on your machine, after every edit, with no script of
ours in between: put `VARIANCE_AUTHORITY_SINCE=` in front of the runner you
already call. Add `VARIANCE_AUTHORITY_AT_DISTANCE=0-1` to keep the tests within
one import of the change, and you or your coding agent read a verdict in about a
second, while the edit is still fresh. Each run also refreshes the record, so the
push that follows has less to run. A full run before the change is done is
still the gate.

[Run the tests an edit needs](test-an-edit.md) and its
[loop an agent runs after each edit](test-an-edit.md#the-loop-an-agent-runs-after-each-edit).
[Measure test distance](distance.md) says how the order is counted.

## What it measured on real suites

Measured in test file runs, selection ran [57% fewer on Zod](selection-zod.md), a package
whose tests nearly all reach its code through one barrel, and
[78% fewer than Nx on TanStack Query](selection-tanstack-query.md), a
27-package monorepo.
