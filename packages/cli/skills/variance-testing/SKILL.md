---
name: variance-testing
description: Write, fix and debug tests with the record Variance Authority keeps. Use it when a test fails, flakes or passes when it should not, when you need the tests an edit reaches, or when you write tests for a change. Not for visual review.
---

# Testing with Variance Authority

A wrapped runner records which case ran which region of which module, on every
run. This skill is the order to ask that record in while you work on tests. The
flags, the refusals and the edge cases are in the `variance-authority` skill
beside this one; each step links the reference that owns it.

Check the project first: its runner config calls `withTestSelection`, and
`variance covering --file <a source file>` answers rather than refusing as
`unrecorded`. If the runner is not wrapped, nothing below has a record to read,
and wiring it is product work, not part of fixing a test.

## Before you edit: which tests stand on the line

```bash
variance covering --file src/cart.ts --function removeItem --hops
variance covering --file src/cart.ts --line 40-60
```

No run is needed: this reads what the last run recorded. `--hops` puts the
nearest test files first. Once your edit is in the file, pass the edited text
with `--text <file>` so the ranges follow it. A range marked `alone` has one
case standing on it; `hole` is unknown, never untested.
[covering](../variance-authority/references/covering.md)

## After each edit: run what it reached, nearest first

```bash
VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=0-2 npx vitest run
VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=3- npx vitest run
```

Read the first stderr line: `selected N of M`, or `declined:` with the reason
every file ran. Run both legs before you call the edit verified. Use the
repository's own script when it has one.
[test selection](../variance-authority/references/test-selection.md)

## A test fails: find where it went

Take the failing test's file and name from the runner's output. When the stack
trace names the line, open the line. When it does not — the assertion failed on
a value made elsewhere, or the test passes when it should not — record that one
test and read its route:

```bash
VARIANCE_AUTHORITY_STORY=1 npx vitest run src/cart.test.ts -t "removes the last item"
variance story --name "cart > removes the last item"
```

Find the step where the route left the path you expected, or the `✗` on the
branch the test is named for. Pass one test file and `-t`, never a directory,
a pattern or no argument, and never record in CI.

| The test | Record | Then ask |
|---|---|---|
| fails on some runs | the same test until it has passed and thrown, twice each | `story --name <name> --compare outcome` |
| passes alone, fails with its file, or the other way | under `VARIANCE_AUTHORITY_STORY=alone` with `-t`, then `=file` without, twice each | `story --name <name> --compare alone,file` |
| behaves differently under a flag or a mock | each side under its own label, such as `=flag-on` | `story --name <name> --compare 1,flag-on` |

A listed difference holds on every reading of one side and on none of the
other: open the place it names. What differs between readings of one side is
counted on the last line and is not the cause.
[story](../variance-authority/references/story.md)

## See a value: print it from the code

A story shows what the code printed at each step: `console` lines, Eyes entries
in a component test, `vae` announcements. It records places, never values. When
the question is a value, or the comparison says *nothing separates the sides*:

1. Add a `console.log` of the value at the line the story names, in the product
   code. The test stays as written.
2. Record the test again, both sides when you compare.
3. Read the line under its step, or in the comparison.
4. Remove the `console.log` before you fix anything.

The log is a probe on one run, not a change to what the test checks. A story
covers the test's own process under Vitest, Jest and Rstest. A Playwright test
writes none: its probe is a line in the spec that asserts nothing,
`variance.snapshot()` to send what the page holds and go on, or
`await variance.observe()` to stop there, read from a watcher. Remove it the
same way.
[live run](../variance-authority/references/live-run.md)

## Write tests for a change

```bash
variance covering --since main
```

It names every region the diff changed with the cases that ran it, and counts
regions **no case ran** and regions **one case alone** ran. Write a test for
each region the change needs pinned, then check that it lands:

1. Run the new test. `covering --file <path> --line <n> --cases last` lists it,
   or its story has no `✗` on the branch it is for.
2. Break the line it is for, run the cases `covering` names for that line, and
   see one fail. A test that passes on a broken line pins nothing. Restore the
   line.

A test that pins changed behaviour fails on the code as it was, before the code
changes.

## Rules

- **Absent is not empty.** A refusal, an `unmeasured` distance or a `hole` is
  missing information, never *no test*.
- **The record is the last run.** After an edit to the test, its mocks or a file
  on its route, run it again before you quote its story or its coverage.
- **Every narrowing is a smaller claim.** The full suite is the only green that
  counts.
