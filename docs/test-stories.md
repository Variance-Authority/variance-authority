# See what one test runs, in order

A **test story** is the code one test ran, in the order it ran it: each
function it went through, the branch it took at each `if`, the branches it
never took, and how many times each loop ran. It is for looking closely
at a few tests: one test, one test file, or the tests you know go through the
function you are about to change. Read it to follow how that code runs, then
open only the lines it names.

Coverage already tells you which code a test ran, as a set: each function and
branch ran or did not, in no order and with no counts. [Test
selection](coverage-test-selection.md) records that set for every test on every
run, and calls it the test's [journey](journeys.md). A test story lists the
same code in the order the test ran it, with a number for each step and a count
for each loop, and a run writes one only when you ask. The figure draws one
test both ways.

## Why reading the test is not enough

A test names what it calls, not what that call does. `cart.removeItem()` can go
through four files or forty, and the imports at the top of a file do not say
which of them run for this input. Most of what a test imports, it never runs:
in TanStack Query, 149 of 188 test files load `query.ts`, and the median
function body, branch or loop body in it runs in 29 of them, as [test
selection](coverage-test-selection.md#what-the-record-keeps) measures.

So without the order you open files one at a time and guess which parts
matter, or you set breakpoints and step through one place at a time. An agent
works the same way, and every file it opens to find the order costs tokens
before it reads a line it needs. A test story gives you the order in one
command, and its output stays under 5,000 characters however long the test is.

[Wallaby.js](https://wallabyjs.com/docs/features/test-stories/) shows the same
idea inside your editor while a test runs, with the value each line saw. Here
your own runner writes the story into [the cache](cache.md): Vitest, Jest or
Rstest, with [Sense](../packages/sense/README.md) installed, the package that
records coverage for test selection. You read it with one command, in a
terminal or from an agent. A test story shows no values. For a value, set a breakpoint
at the line the story names.

## When to read one

Most tests you can follow by reading them and the code they call. Record a
story when that reading leaves your question open:

- **You are about to change code you do not know.** Reading the source does not
  always say which code runs: a call through an interface, a plugin, or a
  handler registered in another file. Ask which tests run the function, and
  read the story of one to three of them:

  ```bash
  variance covering --file src/cart.ts --function removeItem --hops
  ```

  Each story is the route from the test to that function and back, with the
  branch taken at each `if`. A branch marked `✗` is code these tests never ran,
  so they pass whatever an edit there does. [Test-level
  coverage](test-level-coverage.md#the-process) describes `covering`.
- **A test gives a result you do not expect, and nothing names the cause.** A
  failed assertion names the line in the test, not the code that made the
  value. Find the step where the route left the path you expected. A test that
  passes when it should not is often a test whose branch is marked `✗`, or
  whose route goes into a mock and not into the code it names.
- **A test passes alone and fails with its file, or fails alone and passes
  with its file.** Record it both ways, alone with the test-name filter and then
  with its whole file, and read the story after each run, because the second run
  replaces the first. `before the test` shows what the runner ran just before
  it, such as another test's `afterEach`. The first step where the two routes
  differ is where to look.
- **You give one test to an agent to fix or extend.** The agent reads the story
  first and opens only the lines it names, instead of reading files to find
  out where the test goes. The `variance-authority` skill that ships with
  [the CLI](../packages/cli/README.md) tells an agent when to ask for it.

## When not to record one

Recording adds work at every piece of code the test runs, and writes a story
for every test in the run. For the one test you are looking into, the run takes
about as long as without it. For many tests the run is slower and the stories
are large, and nobody reads them.

- **Not the whole suite, not a package, and not in CI.** A run records every
  test it runs, so a run given a directory, a pattern or nothing records all of
  them. Name one test file, and a test name when you have one.
- **Not to find which tests run a line.** That question has no order in it.
  `variance covering` answers it from the record every run already keeps.
- **Not a performance test or a benchmark, and not a question about time.** A
  test that runs a loop many thousands of times runs many times slower while it
  is recorded, and a story holds no times. `for 18 ×400`, a loop at line 18
  whose body ran 400 times, is a count. Use a profiler for time.
- **Not a question about a value.** A story shows no values. Set a breakpoint
  at the line it names.
- **Not when a stack trace already names the line.** Open that line.

## Record one

A story comes from the same recording as test selection, so your suite needs
[Sense](../packages/sense/README.md) set up for its runner first. Then set
`VARIANCE_AUTHORITY_STORY=1` and name the tests with your runner's own
arguments, one test or one file:

```bash
VARIANCE_AUTHORITY_STORY=1 yarn vitest run src/cart.test.ts -t "removes the last item"
VARIANCE_AUTHORITY_STORY=1 yarn vitest run src/cart.test.ts
```

Each test the run runs writes its story, and a later run of the same test
replaces it. A story is removed 14 days after it was written, with
[the rest of the cache](cache.md#what-is-removed-and-when). Sense writes stories from the same instrumented build that records
journeys, and nothing else changes: the coverage a run records with the
variable is the same, byte for byte, as the coverage it records without it, and
a run without the variable writes no story.

A story is the code as it was when the test ran. After you edit that code, run
the test again with the variable before you read the story again.

## Read it

```bash
variance story --name "removes the last item"
```

`--file` and `--name` match text in the test file path and the test name. A
short test is shown step by step. Each step is one function the test was in,
and under it the branches and loops it went through there, nested as the code
nests them:

```text
story  src/cart.test.ts > cart > removes the last item
  goes through 4 files in 7 steps
  key  step   one function, method or callback, from the test going in or coming back until it goes to another
       ×N     beside a function, how many times the test called it at this step; beside a branch or a loop, how
              many times it ran there; under `steps a-b ran N times`, every pass of them is added
       ✗      a branch the test never took, or a loop whose body never ran
       ↑      a branch or a loop body the test went into at an earlier step; this step runs inside it
       in 255 then:  inside the `then` branch of the `if` on line 255

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
ended in `notify`. The `then` at line 14 never ran, so this test does not check
it.

- **A step** is one stop on the route, numbered in the order the test got
  there. A function is named by where it is declared in its file:
  `Cart/removeItem` is the `removeItem` method of `Cart`, and `beforeEach.arg0`
  is the callback passed to `beforeEach`. A module's top level is a step too.
  Files are named by the shortest path suffix that no other file on the route
  shares, and the line above the route says which directory each is in.
- **`if 14  then ✗  else ×1`** is one `if`, named by the line it starts on,
  with both of its branches and how many times each ran. `for 18 ×2` is a loop
  whose body ran twice. A `switch` names each case by its line, a `try` names
  its `catch` and `finally`, and an `await` is shown by its line alone.
- **`✗`** is a branch the test ran nowhere: not at this step, not at any other,
  not before the test. Whatever that code does, this test does not check it. An
  `else` nobody wrote is shown like any other, so `then ×6  else ✗` is a
  condition that was true every time.
- **What sits inside one branch** is shown under its `if` and names the branch,
  `in 255 then: if 257  then ✗  else ×4`, so you read the nesting from the words
  and not from a column.
- **`↑`** is a branch the test went into at an earlier step, which this step
  runs inside: the steps between were calls made from within it.
- **`steps 4-5 ran 2 times in all:`** is a loop, shown once with the steps of
  one pass under it. Passes that took different branches are still one loop,
  and their counts add: `applyTier ×2` with `then ×1  else ×1` is two calls, one
  through each branch.
- **`loaded 3 files: …`** is modules loaded one inside another, each file named
  once.
- **`before the test`** is what the runner ran outside the test just before it,
  such as `beforeEach`, or the previous test's `afterEach`.

Several visits in a row inside one function are one step. Coming back to the
caller is a step of its own, which is why `Cart/removeItem` is step 3 and step 6.
Step 6 ran no branch or loop: it ran from the end of the loop to the end of
`removeItem`, and code that runs straight through is not shown. The `then ✗` is
listed again because a branch the test never took is listed at every step in
its function.

The step before another is where the test came from, not always its caller. The
recording keeps which code ran, in order, and not calls and returns. When a
function returns without running any other instrumented code, no visit records
the return, and the next step follows the last code that ran.

### A long test starts with a table of contents

A test that goes through hundreds of functions does not fit on a page, and you
rarely need all of it. So the story is shown at the most detailed level that
fits in 5,000 characters, and says which level it chose and how long the next
one down is:

| Level | One line for |
|---|---|
| packages | each workspace package the test went through, with its steps |
| files | each file, grouped by package |
| declarations | each function, under its file, with its steps |
| steps | each step, except that steps in a row inside another package are one line |
| every step | each step |

This is the largest test in this repository's own suite, 116 steps shown by
declarations:

```text
story  packages/core/src/relate/merkle.test.ts > the closure digest > calls a new node changed rather than absent
  goes through 5 files in 116 steps
  drawn by declarations: by every step it would be 11712 characters, and a story is kept under 5000;
  narrow it with --in <package or file> or --around <step>, or read every step with --whole
  key  step   the test going into a function or coming back to it; 39×6 is step 39, repeated 6 times

  packages/core/src/format/hash.ts
    31-33  digestString  steps 1×4, 40×12, 47×6, 56×5, 95×16, 102×8
    77-79  digestCombine  steps 46×6, 101×8
  …
```

Then you read the part you care about, and the level is picked again inside it:

- `--in <package or file>` gives the steps through the files whose path contains
  the text, or the files of the package named, with one step either side.
- `--around <step>` gives the three steps either side of one, and the loops
  they sit in.
- `--whole` gives every step, however long.

A part says which steps it keeps in the line under the header, and a part that
leaves steps out says so with a line like `… steps 1-2 left out`, so you know
what to ask for next. Branches and loops are shown only at the two step levels:
on a table of contents they would fill most of the page.

### Other packages are collapsed

A test in an application goes through the workspace's other packages: a design
system, a utility library. At the steps level, the steps in a row inside a
package other than the test's own are one line, naming the package, the steps
and the functions they were in. The package is the nearest `package.json` above
the file.

```text
story  src/checkout.test.tsx > checkout > pays
  goes through 6 files in 268 steps
  drawn by steps: by every step it would be 7240 characters, and a story is kept under 5000;
  narrow it with --in <package or file> or --around <step>, or read every step with --whole
  passed through @acme/ui, one line for each series of steps in a row there; open one with --in <package>
  key  …

  in src: checkout.tsx, pay.ts

    1  Checkout  checkout.tsx:10-60
    2  through @acme/ui, steps 2-141: Button, Icon, useTheme
  142  Checkout/onPay  checkout.tsx:40-52
         if 42  then ×1  else ✗
  143  through @acme/ui, steps 143-267: Button, Icon, useTheme
  268  pay  pay.ts:3-20
```

A step back in your own package ends the line, so a callback into the
application stays on the route. `--in @acme/ui` opens the package, and its steps
are shown like your own.

`--format json` gives the same answer as data: the story with its `level`, the
size of the next level down in characters as `finer`, and, at the step levels,
the branches the test never took as `untaken`. When the text matches several
tests, you get the list of them instead, and you narrow the text.

## What the route leaves out

The route is drawn from a recording of every piece of code the test ran, in
order, and it does not show all of that recording:

- **The order inside a step.** The branches of a step are shown in the order
  the code has them, not in the order of every visit.
- **How each pass differed.** A loop is shown once, with the branches and counts
  of all its passes added together.
- **Another test's work.** When a runner tracks tests through async context and
  another test's work runs in the middle of this one, that work is left out,
  and the header says how many times it happened.

The header also says when the recording filled up before the test ended, and
when the test threw. It lists the files it shows by file name alone: the
[execution record](execution-record.md) does not have their functions as the
test ran them, because the file changed since or was never recorded. Run the
test again to name them.

A story covers the test's own process. A test that runs in a browser page
(Vitest browser mode) writes no story, and neither does code the test calls in
another process, such as a server.

## What a test story is not

Nothing selects on a test story or compares it. Selection and comparison read
journeys, which are sets, so the order in which async code happens to run does
not change them. A test story is the order one process ran one test, one time.
It is not a call stack: when a test awaits twice, the code after each `await`
appears where it ran, not under the call that started it.
