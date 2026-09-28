# ADR-0083 — a hole is found by reconciling the inventory with the record

**Status:** proposed
**Date:** 2026-09-28
**Relates to:** ADR-0002 (absent is not empty),
[ADR-0069](0069-every-answer-has-an-owner.md) (every answer has an owner;
holding an answer and not using it is a bug),
[ADR-0076](0076-a-suite-is-declared-and-records-alone.md) (a suite records
alone),
[ADR-0081](0081-a-coverage-ratio-is-reported-never-read.md) (the count of code
no suite runs),
[spec 0082](../../specs/0082-a-test-that-did-not-run-is-named.md) (what is not
built),
[`packages/sense/src/test-selection/finished-files.ts`](../../../packages/sense/src/test-selection/finished-files.ts),
[`packages/sense/src/test-selection/jest-reporter.ts`](../../../packages/sense/src/test-selection/jest-reporter.ts),
[`tools/unrun.mjs`](../../../tools/unrun.mjs)

## Context

A test runner reports a test that did not run as a number. Vitest ends with
`… | 24 todo (1913)` and prints none of the twenty-four titles. A skipped test
counts toward a green run. A block gated on a browser becomes skips on every
machine without one, so the machines that run the least of the suite report
the most green.

This repository reads its own todo titles with `tools/unrun.mjs`, which greps
the source. A grep cannot see a generated test (`test.each`, a loop), cannot
tell a skip the file wrote from one the runner wrote, and cannot say whether a
skipped test ran on another machine.

The reporters already know all of that. `taskComplete` reads every test's mode
and outcome, tells a skip the file asked for from one a name filter, a cancel
or a failed `beforeAll` wrote (`stopped`, `runnerSkipped`), and the Jest
reporter reads `pending` and `todo` the same way. The run uses that only to
decide whether a file's record is whole. Then it drops the titles.

## Terms

Each has one meaning, and CLI output and public pages use them in this sense.

- **Inventory.** Every test a suite declares, as the runner's own collection
  lists it, with each test's title, file, line and declared kind. The
  inventory is what exists. It says nothing about what ran.
- **Declared kind.** How the source declares a test:
  - *test*: runnable;
  - *skipped*: `it.skip`, `describe.skip`, Playwright's `test.skip`;
  - *conditional*: `skipIf`, `runIf`, or a gate such as
    `const live = READY ? describe : describe.skip`; the condition decides per
    machine;
  - *todo*: `it.todo`, Playwright's `test.fixme`; a title with no body.
- **Record.** What ran, per suite and per machine, as the execution record
  already keeps it.
- **Reconcile.** Compare the inventory with the record, test by test. The
  findings below are results of this comparison. None of them is a label on a
  test.
- **Hole.** A test in the inventory that could run, and did not. A *skipped*
  test is a hole wherever it is skipped. A *conditional* test is a hole only
  where no recorded machine ran it. A *test* that no recorded run ran is a
  hole. A hole looks like coverage and is not, so it is the finding that
  matters most.
- **Named gap.** A *todo* in the inventory. Nothing runs, and the absence has
  a place, a sentence and, by this repository's convention, what it `needs`.
  It is not coverage and it is not a hole: nothing pretends to run.
- **Gap.** Code no test runs, with nothing in the inventory for it. It is
  found from the record, by `variance coverage` and `covering`, not from the
  inventory.
- **Not run.** The union of holes and named gaps: what the inventory declares
  and the record does not show running.

Verbs, used literally: an inventory is *listed*, *counted*, *compared* (two
commits) and *reconciled* (with the record). It is never *taken*, and
*inventory* is never a verb.

## Decision

**The runner's collection owns the inventory, the record owns what ran, and a
hole is only ever the result of reconciling the two.**

1. **The inventory comes from the runner** (ADR-0069). The recording run's
   reporter keeps the tree it already reads: every test's title, file, line,
   declared kind, and whether the file or the runner wrote a skip. Nothing
   parses test files to find tests. A generated test is in the inventory
   because the runner collected it.
2. **A runner-written skip is not a declared kind.** A test skipped by a name
   filter, a cancel or a failed hook is recorded as *not reached in this run*,
   keeps its declared kind, and is reconciled as such. This is the distinction
   `runnerSkipped` and `stopped` already make.
3. **Reconciliation is per machine, and answered across machines.** Each
   recorded suite contributes its own run. A conditional test is a hole only
   when no recorded run of its suite ran it. The answer names where each hole
   did not run and where, if anywhere, it did.
4. **Comparing two inventories is a first reading.** Against a base commit, the
   answer lists tests added, tests removed, and tests whose declared kind
   changed (a *test* that became *skipped* is a new hole). A removed test and a
   new skip both pass CI today, which is why this reading exists.
5. **Absent is not empty** (ADR-0002). A suite with no recording has no
   inventory and is printed as unrecorded, never as *no holes*. A file whose
   collection failed is named, not counted as zero tests.
6. **Nothing reads it back.** No selector, verdict or exit code takes a hole
   count as input. A gate on it is a line in the caller's CI. This is the same
   position ADR-0081 takes on coverage ratios.

## What this forecloses

- **Finding tests by parsing source.** A grep or a parser answers a different
  question from the runner, and misses every generated test. `tools/unrun.mjs`
  keeps its grep because it reports on a checkout that does not build, and it
  keeps `// TODO:` and `// FIXME:`, which are notes in code, not tests.
- **A hole as a stored flag.** A test is not a hole in the inventory. It is a
  hole in the comparison, and it stops being one the moment a run covers it.
- **Counting a todo as coverage or as a hole.**
- **Treating a skip as green.** The answer never folds skipped tests into
  passes.

## Cost

- The inventory is as recent as the last recording of each suite. A test added
  since is not in it until a recorded run collects it. The answer prints each
  suite's recording commit.
- A runner that cannot list tests without running them gives no inventory for
  a suite that was never recorded.
- The record grows by one row per declared test, titles included. It is text
  and it is bounded by the suite.
- *Gap*, *hole* and *named gap* are figures of speech, and the register allows
  them only as names. Each needs its owning public page before any other page
  uses it.
