# See what one test runs, in order

A **test story** shows you the code one test ran, in the order it ran it: each
function it went through, the branch it took at each `if`, the code it never
ran, and how many times each loop ran. You record one when reading the test has
not answered your question: before you change code you do not know, when a test
fails and nothing names the cause, or when a test fails on some runs and passes
on others.

## One test, start to finish

Say you are about to change what `removeItem` does when it is called on a cart
that is already empty, and the test `removes the last item` looks like it
covers that. Before you trust it, record its story and read it:

```bash
VARIANCE_AUTHORITY_STORY=1 yarn vitest run src/cart.test.ts -t "removes the last item"
variance story --name "removes the last item"
```

```text
story  src/cart.test.ts > cart > removes the last item
  goes through 4 files in 7 steps
  key  …

  in src: cart.test.ts, cart.ts, price.ts, format.ts

  before the test
  1  beforeEach.arg0  cart.test.ts:3-8
  the test
  2  loaded 3 files: cart.ts, price.ts, format.ts
  3  Cart/removeItem  cart.ts:12-30
       if 14  then ✗  else ×1
       for 18 ×2
     steps 4-5 ran 2 times in all:
  4    applyTier  price.ts:6-8 ×2
         if 7  then ×1  else ×1
  5    formatPrice  format.ts:14-19 ×2
  6  Cart/removeItem  cart.ts:12-30
       if 14  then ✗
  7  Cart/notify  cart.ts:33-35
```

Read it top to bottom. The runner ran `beforeEach`. Then the test loaded three
modules, called `removeItem`, took the `else` at line 14, called `applyTier` and
`formatPrice` twice from the loop at line 18, came back to `removeItem`, and
ended in `notify`.

The line that answers your question is `if 14  then ✗`. The `then` at line 14
is the empty-cart branch, and this test never ran it. Whatever you write there,
this test passes. So you write a test for that branch before you change it, and
you open only the files and lines the story names.

A story this short prints a key to its marks above the route, left out here:
`✗` is code the test never ran, and `×2` is how many times it ran. Each step
is one function the test was in, named by where it is declared:
`Cart/removeItem` is the `removeItem` method of `Cart`, and `beforeEach.arg0`
is the callback passed to `beforeEach`. Under a step are the branches and loops
the test went through there.

## Why reading the test is not enough

A test names what it calls, not what that call does. `cart.removeItem()` can go
through four files or forty, and the imports at the top of a file do not say
which of them run for this input. Most of what a test imports, it never runs:
in TanStack Query, 149 of 188 test files load `query.ts`, and the median
function body, branch or loop body in it runs in 29 of them, as [test
selection](coverage-test-selection.md#what-the-record-keeps) measures.

So you open files one at a time and guess which parts matter, or you set
breakpoints and step through one place at a time. An agent works the same way,
and every file it opens to find the order costs tokens before it reads a line
it needs. A test story gives you the order in one command, on one page: it is
drawn to fit 5,000 characters, and says how to open any part of it in more
detail.

Coverage answers a different question. It counts how often each line ran
across the whole suite, and says nothing about which test ran it or in what
order. Test selection records, for every test on every run, the set of code
that one test ran, and calls it the test's [journey](journeys.md): each
function and branch ran or did not, in no order. A test story is the same code
in the order the test ran it, with a number for each step and a count for each
loop, and a run writes one only when you ask. The figure draws one test both
ways.

[Wallaby.js](https://wallabyjs.com/docs/features/test-stories/) shows the same
idea inside your editor while a test runs. Here your own runner writes the
story, under Vitest, Jest or Rstest, and you read it with one command, in a
terminal or from an agent.

## When to record one

Most tests you can follow by reading them and the code they call. Record a
story when that reading does not answer your question:

- **You are about to change code you do not know.** Reading the source does not
  always say which code runs: a call through an interface, a plugin, or a
  handler registered in another file. Ask which tests run the function, and
  read the story of one to three of them. A branch marked `✗` is code those
  tests never ran, so they pass whatever an edit there does. [Test-level
  coverage](test-level-coverage.md#the-process) describes `covering`:

  ```bash
  variance covering --file src/cart.ts --function removeItem --hops
  ```

- **A test gives a result you do not expect, and nothing names the cause.** A
  failed assertion names the line in the test, not the code that made the
  value. Find the step where the story differs from the path you expected. A
  test that passes when it should not may have its branch marked `✗`, or run a
  mock and not the code it names.
- **A test fails on some runs and passes on others.** Record it until it has
  done both, then compare the runs that passed with the runs that failed.
  [Compare readings](#compare-readings-of-one-test) shows how.
- **A test passes alone and fails with its file**, or fails alone and passes
  with it.
  Record it both ways and compare them the same way. `before the test` in each
  story shows what the runner ran just before it, such as another test's
  `afterEach`.
- **You give one test to an agent to fix or extend.** The agent reads the story
  first and opens only the lines it names. The `variance-authority` skill that
  ships with [the CLI](../packages/cli/README.md) tells an agent when to ask for
  one.

## When not to record one

Recording adds work at every piece of code the test runs, and writes a story
for every test in the run. For the one test you are looking into, the run takes
about as long as without it. For many tests the run is slower, the stories are
large, and nobody reads them.

- **Not the whole suite, not a package, and not in CI.** A run records every
  test it runs, so a run given a directory, a pattern or nothing records all of
  them. Name one test file, and a test name when you have one.
- **Not to find which tests run a line.** That question has no order in it.
  `variance covering` answers it from the record every run already keeps.
- **Not a performance test or a benchmark.** A loop that runs many thousands of
  times runs many times slower while it is recorded, and a story has counts,
  not times. Use a profiler for time.
- **Not when a stack trace already names the line.** Open that line.

## Record one

A story comes from the same recording as test selection, so your suite needs
[Sense](../packages/sense/README.md) set up for its runner first. Then set
`VARIANCE_AUTHORITY_STORY=1` and name the tests with your runner's own
arguments, one test or one file:

```bash
VARIANCE_AUTHORITY_STORY=1 yarn vitest run src/cart.test.ts -t "removes the last item"
VARIANCE_AUTHORITY_STORY=1 yarn jest src/cart.test.ts -t "removes the last item"
```

Each test the run runs writes its story into [the cache](cache.md), under
`coverage.stories/`. A test keeps the stories of its last 16 runs, and each one
is a **reading** of that test. `variance story` shows the newest, and its
header says how many are kept. A story is removed 14 days after it was written,
with [the rest of the cache](cache.md#what-is-removed-and-when).

To tell runs apart later, set the variable to a label in place of `1`, such as
`VARIANCE_AUTHORITY_STORY=flag-on`, and read the newest reading under it with
`--label flag-on`. A label is letters, digits, `_` and `-`, up to 40
characters: any other character is written as `-`, so `flag on` is recorded as
`flag-on`, and `--label` takes the recorded form. A run with the variable set
to `1` has no label, and `--label` and `--compare` call it `1`.

The variable adds the stories and changes nothing else: the record the run
keeps for test selection is the one it keeps without it. A story is the code
as it was when the test ran, so after you edit that code, run the test again
before you read its story again.

## A long test starts with a table of contents

A test that goes through hundreds of functions does not fit on a page, and you
do not need all of it. So a story is shown at the most detailed level that fits
in 5,000 characters: every step; then every step, with the steps inside other
workspace packages shown as one line; then each function with the steps it was
at; then each file; then each workspace package. The header says which level it
chose and how long the next one down would be:

```text
story  packages/core/src/relate/merkle.test.ts > the closure digest > calls a new node changed rather than absent
  goes through 5 files in 116 steps
  drawn by declarations: by every step it would be 11712 characters, and a story is kept under 5000;
  narrow it with --in <package or file> or --around <step>, or read every step with --whole
```

Then you ask for the part you need, and the level is picked again inside it:

```bash
variance story --name "calls a new node" --in hash.ts     # the steps through one file or package
variance story --name "calls a new node" --around 40      # three steps either side of step 40
variance story --name "calls a new node" --whole          # every step, however long
```

When steps inside another workspace package, such as your design system, are
shown as one line, that line names the package, and `--in` opens it.

## See the values the code printed

A step says where the test was, not with which values. But the code can print
the values, and a story writes each line it prints under the step where it
printed it, after `»`:

```text
  3  Cart/removeItem  cart.ts:12-30
       if 14  then ✗  else ×1
       » console.log removing A1, stock 0
       » eyes getByRole("button", {"name":"Save"}) → button "Save" in SaveBar
```

Three sources write these lines, and you install nothing more for any of them:

- **`console`.** Each line printed with `console.log`, `info`, `warn`, `error`
  or `debug`. The console still prints it.
- **[Eyes](eyes.md)**, when your tests use it. Each query with its arguments and
  what it found, each event and the element it fired on, each React commit with
  the components that rendered, and each Arrange, Act and Assert phase you mark.
- **[`vae`](../packages/event/README.md).** Each announcement the product code
  makes, such as `vae once checkout upsell-modal decided`.

So when you need to know which value a call got, add a `console.log`
that prints it, record the test again, and read the line at its step. A step
shows its first 5 lines and counts the rest.

## Compare readings of one test

A test that fails on some runs is where you most want to compare two runs, and
where reading two stories side by side misleads you most. Code after an
`await` runs when its promise settles, and two promises started together settle
in either order, so an async test can run in a different order on each run,
including runs that all pass. A changed order is not a flake. But sometimes the
order is the cause: on every run that fails, the response arrives before the
click, and on every run that passes, it arrives after.

**`--compare` shows only the differences that are true of every reading on one
side and of no reading on the other, and counts the rest without listing
them.** Record the test until it has both passed and failed, two or three times
each, then:

```bash
variance story --name "removes the last item" --compare outcome
```

```text
compare  src/cart.test.ts > cart > removes the last item
  passed (3 readings) against threw (2 readings, every one threw)

  only when it passed, on every reading:
    went into  removeItem  src/cart.ts:12-30, the then of the if on 19

  only when it threw, on every reading:
    said       » console.log stock 0

  in the opposite order when it passed and when it threw, on every reading:
    » eyes click on button "Save" in SaveBar
      before price  src/cart.ts:32-36 when it passed, after it when it threw

  left out, because they differ between readings of one side as well: 1 place, 4 lines said, 37 pairs in changing order
```

This says three things, and each one names a place to open:

- **Where the test went.** Every run that passed took the `then` at line 19 of
  `cart.ts`, and no run that failed did.
- **What the code printed.** Every run that failed printed `stock 0`, and no run
  that passed did. A line with a time or an id in it has different text on every
  run, so it is counted, not listed.
- **In what order.** On every run that passed, the click on Save came before
  `price` ran, and on every run that failed, after it. When several pairs are
  listed, the first is where the two orders first differ.

The last line counts everything that also differs between runs on the same
side: here one place some runs went and others did not, four printed lines, and
37 pairs of functions whose order changed from run to run. One pair changed
order the same way every time. Those 37 are what you would have read
through if you compared two stories by hand.

When nothing is true of every reading on one side, the comparison says
`nothing separates the sides`. That is an answer too: the runs went to the same
places, printed the same lines, and kept the same order wherever the order was
steady. The difference is in a value nothing prints, or in code that is not
recorded, such as a dependency. Print the value you suspect with `console.log`,
and record again.

With one reading on a side, the comparison cannot tell what the side does from
what that one run happened to do, and it says so under its first line. A test
keeps its last 16 readings, so the runs you made earlier still count.

### Choose the sides

A side is either the same test read again, where only the run differs, or a
setup you chose, where you name what differs. [A/B
testing](a-b-testing.md#every-pair-states-what-differs) makes the same
distinction for screenshots:

| `--compare` | One side | The other side | What differs |
|---|---|---|---|
| `outcome` | the readings that passed | the readings that threw | nothing you chose: the run |
| `last` | the newest reading | the reading before it | the run, and anything you edited between the two |
| `<a>,<b>` | the readings labelled `a` | the readings labelled `b` | what you set up differently for each label |

Use `outcome` for a test that fails on some runs. Use labels for a test that
passes alone and fails in its file, a feature flag on and off, or two versions
of a dependency. For a test that passes alone and fails with its file, record
each setup twice under its own label, then compare the labels:

```bash
VARIANCE_AUTHORITY_STORY=alone yarn vitest run src/cart.test.ts -t "removes the last item"
VARIANCE_AUTHORITY_STORY=file yarn vitest run src/cart.test.ts
variance story --name "removes the last item" --compare alone,file
```

`--compare last` is always one reading against one, so use it to see what an
edit changed, not to explain a flake.

## What a story does not show

- **Values the code does not print.** Set a breakpoint at the line the story
  names, or print the value and record again.
- **Other processes.** A story covers the test's own process. A test run by
  Playwright or in Vitest browser mode writes no story, and neither does code
  the test calls in another process, such as a server.
- **The order inside one step, or how each pass of a loop differed.** A step
  lists its branches in the order the code has them, and a loop is shown once,
  with the counts of all its passes added together. Use a debugger for that.
- **Calls and returns.** A story is not a call stack. The step before another is
  where the test came from, not always its caller, and code after an `await`
  appears where it ran, not under the call that started it.

The header says when a story is incomplete: the recording filled up before the
test ended, the test printed more than the 4,096 lines a story keeps, the test
threw and the story ends where it stopped, another test's work ran in the
middle of this one and was left out, or a file is shown by name alone because
it changed since the test ran. For the last one, run the test
again.

Nothing selects tests on a story. [Test selection](coverage-test-selection.md)
reads journeys, which are sets, so the order async code happens to run in does
not change what it selects. `--format json` gives any story or comparison as
data.
