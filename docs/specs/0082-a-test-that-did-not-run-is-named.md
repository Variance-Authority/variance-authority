# Spec 0082 — a test that did not run is named

**Missing:** the inventory and the reading. The recording run's reporters read
every test's mode and outcome, and tell a skip the file wrote from one the
runner wrote, but only to decide whether a file's record is whole. The titles
are dropped. Nothing lists what a suite declares, nothing reconciles it with
what ran, and nothing compares two commits' inventories. So a skipped test, a
gated block and a deleted test all leave CI green, and the only list of todo
titles is a grep in `tools/unrun.mjs` that sees no generated test.
**Built on:** [ADR-0083](../context/adr/0083-a-hole-is-found-by-reconciling-the-inventory-with-the-record.md)
(the terms and the rule), ADR-0002 (absent is not empty),
[ADR-0069](../context/adr/0069-every-answer-has-an-owner.md) (every answer has
an owner),
[ADR-0076](../context/adr/0076-a-suite-is-declared-and-records-alone.md) (a
suite records alone).

## Purpose

A test runner can tell you what failed. It cannot tell you what was written and
never ran, because it prints that as a count. Variance keeps the record of what
ran on every machine, so it is the one tool that can name each test that did
not run, say why, and say whether it ran anywhere else.

## What would discharge it

**1. The recording keeps the inventory.** The Vitest and Jest reporters write
each collected test's title, file, line and declared kind (test, skipped,
conditional, todo) into the suite's record, and mark a skip the runner wrote
(name filter, cancel, failed hook) as *not reached in this run*. A test in
this repository covers each kind, including a `test.each` row and a
browser-gated block.

**2. A reading that names what did not run.** A command lists holes and named
gaps with title and `file:line`, grouped by suite. A conditional test shows
the machines where it did not run and those where it did. The CLI name is
chosen when the command table is written; `variance ask not-run` is the
working name. `--format json` gives the same rows. On this repository the
named gaps equal `yarn unrun`'s todo rows, and the holes include every
browser-gated test on a machine without a browser.

**3. Two inventories compared.** Against a base (`--since <ref>`, or the
mainline's published record, as `covering --against` reads it), the answer
lists tests added, tests removed, and tests whose declared kind changed. A
fixture where a pull request deletes one test and skips another shows both.

**4. Absence is stated.** A suite with no recording is printed as unrecorded.
A file whose collection failed is named. Neither is ever counted as zero
holes. A check covers both.

**5. `unrun` narrows to what it alone can see.** Once item 2 lands,
`tools/unrun.mjs` drops `it.todo` and keeps `// TODO:` and `// FIXME:`, and
`AGENTS.md` names the command for tests.

## When it leaves

When all five are on main: a public page owns *inventory*, *hole*, *named gap*
and *gap* and is added to the concepts registry in
`tools/docs-entrypoints.check.ts`, ADR-0083 becomes `accepted`, the checkpoint
is updated, and this file is deleted.
