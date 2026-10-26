---
name: variance-testing
description: Write, fix, debug, improve and shorten tests with the record Variance Authority keeps. Use it when a test fails, flakes or passes when it should not, when you need the tests an edit reaches, when you write tests for a change or improve a file's coverage, or when a test loads or renders more than it needs. Not for visual review.
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

## See a value the story does not show: print it from the code

A story shows, at each step, the values the function was handed — a number or
a boolean as it is, a string quoted and cut to 40 characters, an object as a
ref and its kind, such as `ref5 Object`, never its contents — what a module's
top level declared, and what the code printed: `console` lines, Eyes entries in
a component test, `vae` announcements. It does not show what an object holds, what a function returned, or a value no function
was handed. When the question is one of those, or the comparison says *nothing
separates the sides*:

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

## Improve a file's coverage

```bash
variance covering --file src/cart.ts --suite unit
```

A range the record can rank has a state; `walked`, two or more cases, needs
nothing. Line coverage reads the other four as covered or not covered; the
record tells them apart:

| state | what it means for a test |
|---|---|
| `unwalked` | no case ran it, and every case that could have finished: write one, once `ask uses` shows the code is called |
| `loaded` | it ran only while the module was imported, and line coverage counts it: assert on what it set up, or leave it |
| `alone` | one case is the only one that fails for it: a second case, if the line matters |
| `hole` | a case stopped before it could; run the file again before you read it |

Each declared suite answers on its own, so a range one suite never walked may
be walked by another; `--suite` names the suite you will write the test in.
For a long file, `--format json` with `--suite` and
`jq -c '.ranges[] | select(.state != null and .state != "walked")'` keep the
ranges to read; without `--suite` the ranges sit under `.suites[]`. A range
with no state is one the record cannot rank. Write each test as the previous section does, run it, and read the range
again with `--line <n> --cases last`: it lists the new case. Then break the line
and see the case fail.
[covering](../variance-authority/references/covering.md)

## Make a test smaller

```bash
variance distill --suite unit --file src/cart.test.ts
variance distill --suite unit --file src/cart.test.ts --test "cart > removes the last item"
```

The file reading names the modules the test file loaded that no case, or only
some cases, entered. For a module no case entered, it names the import that
brought it in: delete it, mock it with a factory when nothing behind it is
used, or import past the barrel; never mock the listed path. A proposed mock
names the module and the values it exports, not a call: write it the way the
test file's runner mocks a module. For one only some cases entered, make it lazy in the code that uses
it, or move those cases to a file of their own. Rerun the file and read it
again: the module is gone from the list, and every case passes. It is withheld
when a case stopped; run the file again.

The case reading names the files one test ran without addressing anything in
them, from the Eyes journal of a component test; each is a candidate, not
permission to mock it. A record with no journal names the source the test ran
and calls the candidates unavailable: the loop below needs a journal, and the
file reading does not. Take one at a time: substitute it at one boundary, rerun
the exact test, distill again, and compare the `assert:` targets and sources and
the update initiators with the first reading. Keep the edit only when they are
what they were and no initiator newly appears outside; revert it otherwise, and
when a reading is unavailable. Two candidates in one rerun do not show which one
was safe.
[distill](../variance-authority/references/distill.md)

## Rules

- **Absent is not empty.** A refusal, an `unmeasured` distance or a `hole` is
  missing information, never *no test*.
- **The record is the last run.** After an edit to the test, its mocks or a file
  on its route, run it again before you quote its story or its coverage.
- **Every narrowing is a smaller claim.** The full suite is the only green that
  counts.
