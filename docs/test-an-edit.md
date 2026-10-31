# Run the tests an edit needs

Set `VARIANCE_AUTHORITY_SINCE` and the Vitest, Jest or Playwright run you already call
leaves out every test file a recorded run shows never executed the code you
changed. Nothing goes on the command line and no script sits between you and
the runner, so the edit-and-test loop you or your coding agent already runs
stays the same loop, only shorter.

`vitest --changed` and `jest --onlyChanged` run every test that imports a file
you changed. Edit one function in a module half the suite imports, and half the
suite runs. A recorded run knows which of those tests executed that function,
and only those run. Under Jest and Vitest it can also skip the cases inside a
file that did not execute it. Each run then updates the record, so your next
edit is measured from what ran last rather than from your branch point.

Wrap the runner configuration once and run the suite once. That run writes the
[record](execution-record.md): which test file executed which lines of which
module, at which commit, kept in [your cache](cache.md) outside the checkout.
From then on, each edit costs one variable:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';

export default withTestSelection(defineConfig({ test: { include: ['src/**/*.test.ts'] } }));
```

```bash
npx vitest run                            # records which test ran which code
# ...edit one function body...
VARIANCE_AUTHORITY_SINCE= npx vitest run
```

Before the first test file starts, the run says how many it kept, for example:

```text
variance-authority: selected 12 of 340
```

## Wrap once, then set one variable

Install two packages: [`@variance-authority/sense`](../packages/sense/README.md)
records the run, and [`@variance-authority/cli`](../packages/cli/README.md)
reads the selection the wrapped configuration asks for.

```bash
npm install --save-dev @variance-authority/sense @variance-authority/cli
```

For Jest 30, wrap the configuration with `withTestSelection` from
`@variance-authority/sense/jest` and run `VARIANCE_AUTHORITY_SINCE= npx jest`.
[The Jest seam](../packages/sense/README.md#cut-a-jest-run-down-to-a-diff) says
which parts of a Jest configuration it reads and which you spell out.

For Playwright, wrap the configuration with `withTestSelection` from
`@variance-authority/playwright-test` and run `VARIANCE_AUTHORITY_SINCE= npx
playwright test`. A spec file the selection keeps runs whole.
[The Playwright seam](../packages/playwright-test/README.md#leave-out-the-specs-a-change-did-not-reach)
says where the files are dropped.

Every wrapped run records, whether the variable is set or not. With it set, the
runner drops the files the record proves your edit did not reach before it
starts any of them, and prints one line to stderr first:

- `selected 12 of 340` — twelve test files run.
- `selected none of 340` — your edit reached no recorded test, so none runs.
- `declined:` and a reason — the record could not answer this edit, and every
  file runs.

Set and empty, the variable measures each test file from the commit a run last
finished it at, which the record keeps per test file: a later run that ran only
some of its cases does not change it. Set to a ref, such as `origin/main`, it
names the base for a record taken outside a git checkout, which keeps no commit. Watch mode does not select, and
neither does Playwright's `--list`. Under Jest,
`--filter` and `--skipFilter` replace the filter the selection runs in, so
either one turns the selection off, and stderr says so.

[The runner seam](../packages/sense/README.md#let-the-runner-skip-them) gives
the details: where the files are dropped, and why `--shard` sees the same list
in every shard. For Rstest or any other runner,
[`variance select`](../packages/cli/README.md#select-what-your-own-runner-may-skip)
prints the same skip list, one path per line, for your script to subtract.

## Run the tests nearest the edit first

A test one import away from the code you changed fails closer to the cause than
a test six imports away, and when it fails, it has fewer modules to suspect.
`VARIANCE_AUTHORITY_AT_DISTANCE` cuts the selection to one range of **hops**,
the import steps between the changed file and each test, counted only through
modules that test executed:

```bash
VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=0-2 npx vitest run
VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=3- npx vitest run
```

`0-2` runs the tests within two imports of the edit, including a test whose own
source you changed, which is zero. `3-` runs the rest. Every selected file runs
in one of the two: a test the record cannot place runs in the one that holds
the furthest hop measured, or in `3-` when none was. When a run was saved at
the commit you are on, as `0-2` saves its own, `3-` also runs any selected file
within two imports that still last ran before it. A test recorded incomplete,
such as one a partial run over your edit left, runs in the leg of the shortest
import path it ran to a changed file it loaded, or only in `3-` when it ran
none, so a near edit still needs `3-` while the record holds one. A new test
runs in both. A value that is not a range fails the run rather than running
another leg. The first leg is feedback, not a verdict;
[distance](distance.md) is the page about what a hop count tells you and what
it does not.

## Skip the cases your edit did not reach

A selected file runs every case it declares, though the record knows which of
them entered the code you changed. Under Jest and Vitest,
`VARIANCE_AUTHORITY_GRAIN=case` skips the rest:

```bash
VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_GRAIN=case npx vitest run
```

The skipped cases show as skipped, as `it.skip` would show them, and the stderr
line counts them: `selected 2 of 340, skipping 31 cases in 2 of them`. A file
runs whole when the record cannot say which of its cases your edit reached:

- the last run of the file was cut. A file run in part is recorded
  incomplete, because the cases it skipped recorded nothing, and a test that
  did not pass whole runs again. So the next selection runs it whole, whatever
  that edit touched, which records it complete again: over a loop of edits to
  the same code, every other run of the file is cut;
- you changed the test file itself;
- the file was selected for a change the record does not split by case: a
  fixture it declares as a precondition, a file it reads from disk, or a
  changed file the record holds no lines for, charged to the tests that ran
  what imports it;
- the changed code ran while a module loaded, such as an import at the top of
  the test file, which every case of the file waits on;
- the record holds the file as running the changed code, but none of its cases
  entering it;
- a test file of the suite was last finished at an earlier commit than the
  latest run. Once you commit between runs, the test files a selected run left
  out or ran only some cases of keep the commit a run last finished them at,
  and every selected file runs whole until one run takes the suite to a single
  commit.

Within a file that is cut, a case that shares its full name with a case your
edit reached runs too, because the runner skips by name.

The cut reads each case's own reach, so it trusts the cases of a file not to
depend on each other. A case that reads what an earlier case left, such as a
memoized result or a variable its `describe` shares, is skipped when it entered
nothing your edit changed, though the value it reads did change. Skipping a
case that sets up a later one fails the later one instead. Where the cases of
a file depend on their order, run it at file grain. Playwright and Rstest
run every selected file whole, and watch mode does not select at either grain.
File grain is the default, and `VARIANCE_AUTHORITY_GRAIN=file` names it.

## Each run moves the starting point

A selected run lands in the record like a full one. The test files it finished
are measured from what they just ran, and the ones it left out or ran only some
cases of keep the commit a run last finished them at, so the next edit is
charged only to the tests that have not seen it:

- **A test a run left out still owes the edit.** If you edit a function and run
  only the near leg, the far tests that executed that function run next time.
- **A commit you make between runs does not widen the next one.** The change
  since a test's commit is compared line by line with the code that test ran,
  as an uncommitted edit is, so a commit adds only the tests that executed the
  lines it changed.
- **A test file you edited runs once.** A run records the text each test's
  own file had, and a setup file the test declared, so the next selection skips
  a test that already ran the text you have now, whether that edit is still
  uncommitted or committed since.
- **A test that did not pass whole runs again.** A failed, skipped or focused
  run records what it executed, and never justifies leaving that file out.
- **An edit that runs nothing differently sends no test back.** A type, a
  type-only import or a comment marks no test, and the next selection reads it
  as nothing to run.

A fresh clone or a new worktree has no run of its own. With the suite set to
share, its first selection reads the record your mainline
[published](sharing.md#a-suite-your-checkout-has-not-recorded), and your runs
are laid over it.

## The loop an agent runs after each edit

A coding agent edits many times before a change is whole, and it needs a
verdict after every edit that costs less than the edit did. The compiler, then
the tests within one import of what changed, gives it one in about a second.
It is one line on the configuration you wrapped and recorded above, and nothing
in it is a script of ours:

```bash
tsc --build && VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=0-1 npx vitest run
```

Under Jest 30 the same two variables go in front of `npx jest`; under Rstest,
`variance select` with the same range prints the files your script leaves out. Give your agent that line as the command it runs after each edit, and tell it
to read the verdict before it makes the next one. Each edit ends one of four
ways:

- **A type error.** The compiler prints it and exits non-zero before any test
  starts.
- **No test runs.** The run prints `selected none of 340` and exits 0. No
  recorded test ran the code you changed, the tests that did already ran the
  text you have now, or they sit further than one import away. The lines under
  it say which: a file left for a later leg is counted with the setting that
  runs it, `VARIANCE_AUTHORITY_AT_DISTANCE=2-`.
  Exit 0 here says nothing near the edit failed, not that the change is done.
- **Some tests run.** The run prints `selected 1 of 340`, runs that file, and
  exits with its result.
- **Every test runs.** The run prints `declined:` and a reason: the record
  could not answer this edit, as [below](#when-it-runs-everything).

When a run keeps or leaves out a test you did not expect, ask why.
[`variance select`](../packages/cli/README.md#select-what-your-own-runner-may-skip)
reads the same change with nothing run, given the same range, and `--suite` with
the name of the suite when `variance.config.json` declares suites:

```bash
npx variance select --suite unit --at-distance 0-1
```

Its stdout lists every test file it skips, one path per line, so a test missing
from that list is one the loop runs. Its stderr says why, for the selection as a
whole:

```text
the change entered 3 test files: 2 at 3 hops, and 1 at 4 hops.
3 selected test files are left for a later leg: the same command with `--at-distance 2-` runs them.
```

The loop says only that the edit broke nothing within one import. The tests
further out still owe the edit, as each run leaves them, so before you hand the
change over, run the same line with `VARIANCE_AUTHORITY_AT_DISTANCE=2-`.
Every selected file runs in one of `0-1` and `2-`, by the same rules that place
it in `0-2` or `3-` above.

This repository's own agents run that line after each edit, as
`yarn test:loop`; [what a selection costs](#what-a-selection-costs) gives its
times.

## When it runs everything

Selection only ever removes files it can prove your edit did not reach, so
everything the record cannot speak for runs:

- **A test file the record has never seen.** A new test runs until a run
  records it.
- **An edit the record cannot read.** No record on this machine, a diff git
  would not produce, or a lockfile that cannot be compared at the base: the run
  prints `declined:` and runs every file.
- **A file nothing imports.** A runner configuration or a setup file is read
  like any other file unless you name it as
  [before reach](changes-before-and-beyond.md); named, a change to it runs the
  whole suite.

A file the record holds nothing about, such as a README or a fixture a test
reads with `fs`, keeps no test in the run, and stderr names it. If a test does
read that fixture, name it in the seam's `preconditions` option, and from the
next recording on a change to it runs every test that declared it.

## What a selection costs

On this repository's own unit suite, 686 recorded test files, reading the
selection for a one-statement edit takes 0.39 s, the median of eight warm runs of
`node_modules/.bin/variance select --suite unit`, which skips 677 of the 686.
That is the reading the runner makes before it starts.

The whole loop on the same suite takes a few seconds. Change one statement in a
function that nine of the suite's test files execute, and
`VARIANCE_AUTHORITY_SINCE= yarn vitest run` prints `selected 9 of 686`, runs
those nine and exits in 3.4 s. Run it again on the same tree and it prints
`selected none of 686` and exits in 0.8 s. Each of those two times is the median
of seven warm runs.

The agent loop on the same suite, grown to 1002 test files, puts the compiler
first: a type error stops in 0.09 s, an edit no test needs answers in 0.73 s,
and a body edit that keeps one test answers in 1.42 s. Each is the median of
five runs, with a one-minute load average between 10 and 13.

Every time in this section was measured on an Apple M4 Max with 64 GB under
Node 24, with a one-minute load average between 4 and 9 on its 16 cores unless
it says otherwise.

What recording adds to a run is measured on public suites in
[what recording costs while the suite runs](selecting.md#what-recording-costs-while-the-suite-runs).

---

**Further:** [Test selection](selecting.md) for what a record shows that an
import graph does not ·
[Distance](distance.md) ·
[Share the record](sharing.md) ·
[The runner seam](../packages/sense/README.md#let-the-runner-skip-them) ·
[`variance select`](../packages/cli/README.md#select-what-your-own-runner-may-skip)
