# Where one test goes, in order

`variance story` gives the code one test ran, in the order it ran it: each
function, the branch taken at each `if`, the branches never taken, and loop
counts, in one answer under 5,000 characters. It reads no config.

Ask it before you open files for one test:

- **A test fails and you do not know the code under it.** Read the route, find
  the step where it went a way you did not expect, and open that line.
- **You are about to edit code for one test.** The steps name the files and
  lines the test runs. Open those, not every file the test imports; most of
  what a test imports, it never runs.
- **You need to know whether this test checks your edit.** A branch marked `✗`
  is code this test never ran, so an edit there passes it whatever the edit
  does. Ask `covering` for the tests that do run that line.

Skip it when a stack trace already names the line, or when the question is
about many tests: `covering` answers which tests ran a line, `story` answers
what one test ran, in order. It shows no values; for a value, use a debugger at
the line it names.

A run writes a story only when asked. Set the variable and always narrow the
run to the one test with the runner's own filter — every test the run runs
writes one, and a later run of the same test replaces it:

```bash
VARIANCE_AUTHORITY_STORY=1 yarn vitest run src/cart.test.ts -t "removes the last item"
VARIANCE_AUTHORITY_STORY=1 yarn jest src/cart.test.ts -t "removes the last item"
```

Recording needs the suite set up with `@variance-authority/sense`. When
`story` answers `no story in this checkout` after such a run, the project does
not have it: stop asking and read the code.

A story is the code as it was when the test ran. After you edit that code, run
the test again with the variable before you read its story again.

Then read it:

```bash
variance story --name "removes the last item"
variance story --file src/cart.test.ts --name "removes" --format json
```

`--file` and `--name` match text the test file path and the test name contain.
When they match several stories, the answer lists them with their visit counts
and prints no route; narrow the text and ask again.

The answer fits a page. It is drawn at the finest level that fits in 5,000
characters — every step, then steps with other workspace packages passed
through, then declarations, files, packages — and the header names the level
and how long the next one down would be. A short test comes back step by step,
with a key for the marks and each step's branches and loops drawn as the code
nests them:

```text
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

A long one opens coarser, and the header says how to go finer:

```text
  drawn by declarations: by every step it would be 11712 characters, and a story is kept under 5000;
  narrow it with --in <package or file> or --around <step>, or read every step with --whole
```

Narrow to the part you need, and the level is picked again inside it:

```bash
variance story --name "removes the last item" --in price.ts   # the steps through these files, one either side
variance story --name "removes the last item" --in @acme/ui   # the steps through a package, opened
variance story --name "removes the last item" --around 6      # three steps either side of step 6
variance story --name "removes the last item" --whole         # every step, however long
```

- A step is one function the test was in — a function, a method, a callback,
  a module's top level — named by its path in the file, then
  `file:start-end`. Visits in a row inside one function are one step; coming
  back to the caller is a step of its own. `×N` after the function is how many
  times the test called it at that step.
- Under it, one line per `if`, loop, `switch` or `try`: `if 14  then ✗  else ×1`
  is an `if` by the line it starts on, both branches, and how many times each
  ran; `for 18 ×2` is a loop body that ran twice. A `switch` names its cases by
  line, a `try` its `catch` and `finally`. Code that only continues past an
  `if` or a loop is not shown.
- `✗` is a branch the test ran nowhere, before the test or during it. This test
  does not check that code, and `then ×6  else ✗` is a condition that was true
  every time. A function not on the route never ran. Whether a test runs one
  line is `covering`'s question: straight-line code is not listed here.
- `in 255 then: if 257 …` is an `if` inside the `then` of the `if` at 255. `↑`
  is a branch the test went into at an earlier step, which this step runs
  inside.
- `steps a-b ran N times in all:` is a loop, shown once; the counts under it
  are all its passes added together.
- `through <package>, steps a-b: names` is a run of steps inside a workspace
  package other than the test's own. Open it with `--in <package>`.
- `… steps 1-2 left out` is what this part leaves out. Ask `--around` a step at
  its edge to read further.
- `loaded N files` is modules loaded one inside another; each file is named
  once.
- `before the test` is what the runner ran outside the test just before it:
  `beforeEach`, the previous test's `afterEach`.
- At the declarations level, `steps 36, 39×6` lists each step the function was
  at; `39×6` is step 39, repeated six times, as calls or returns.

The step before another is where the test came from, not always its caller.
The recording keeps which code ran, not calls and returns, so no step names a
parent; the step numbers are what join two parts you read.

The route is a map. It does not give the order of every visit inside a step or
how each pass of a loop differed; use a debugger for that. What the route could
not show, it says in the header:

- *drawn as the file alone* — the recording does not have that file's
  functions as the test ran them: the file changed since, or was never
  recorded. Run the test again with the variable.
- *the recording filled up* — the visits after the limit are not on the route.
- *another test's work ran in the middle of this one* — under a runner that
  tracks tests through async context, that work is left out.
- *the test threw or rejected* — the route ends where it stopped.

A story covers the test's own process. A test run in a browser page (Vitest
browser mode) writes none, and code the test calls in another process, such as
a server, is not on it.
