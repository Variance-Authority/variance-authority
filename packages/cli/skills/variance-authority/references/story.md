# Where one test goes, in order

`variance story` gives the code one test ran, in the order it ran it: each
function, the branch taken at each `if`, the branches never taken, and loop
counts, in one answer under 5,000 characters. It reads no config.

It is for a close look at a few tests, never at a suite. Record one only when
you can write the question in one line about named tests: which path does this
test take through this function, why does it pass or fail, does it reach the
real code or a mock. Read the source first, and record only when it leaves the
question open:

- **You are about to change code you do not know, and reading does not say what
  runs**: a call through an interface, a plugin, a handler registered
  elsewhere. Ask `covering --file <path> --function <name> --hops` for the
  tests that run it. `--hops` lists the nearest test files first; record the
  first three tests it lists, and no more. Their steps
  name the files and lines to open. A branch marked `✗` is code they never ran,
  so they pass whatever an edit there does.
- **A test's result surprises you and nothing names the cause**: an assertion
  failed on a value made elsewhere, or a test passes when it should not. Find
  the step where the route left the path you expected, or the `✗` on the
  branch the test is named for.
- **A test fails on some runs and passes on others.** Record it until it has
  both passed and thrown, twice each if you can, then ask
  `story --name <text> --compare outcome`. Do not diff two routes yourself:
  async code runs in a different order on every run, so most of what differs is
  not the cause. The comparison lists only what every run on one side did and
  no run on the other did.
- **A test passes alone and fails with its file**, or fails alone and passes
  with it. Record it alone with `-t` under `VARIANCE_AUTHORITY_STORY=alone`,
  then with its whole file under `VARIANCE_AUTHORITY_STORY=file`, twice each,
  and ask `story --name <text> --compare alone,file`.

Never record:

- **A run that names anything but test files.** A run records every test it
  runs, so a directory, a package, a pattern or no argument records all of
  them. Pass one test file, and `-t` with the test's name when you have it;
  for the tests `covering` names, pass their files and names. Never in CI.
- **A performance test or a benchmark**, or a test for a question about time. A
  loop that runs thousands of times runs many times slower while recorded, and
  a story holds no times. If a story shows a loop count in the thousands, or
  says the recording filled up, choose another test.
- **To find which tests run a line.** That is `covering`, from the record every
  run already keeps.
- **For a value the code does not print.** A story shows only what the code
  said: `console` lines, Eyes queries and events, `vae` announcements. Add a
  `console.log` of the value and record again, or use a debugger at the line it
  names.
- **When a stack trace already names the line.** Open that line.

```bash
VARIANCE_AUTHORITY_STORY=1 yarn vitest run src/cart.test.ts -t "removes the last item"
VARIANCE_AUTHORITY_STORY=1 yarn jest src/cart.test.ts -t "removes the last item"
```

Every test the run runs writes its story, and a test keeps its last 16, one
per run: its readings. `story` reads the newest and says how many are kept.
Set the variable to a label in place of `1` to name a run's readings, such as
`VARIANCE_AUTHORITY_STORY=flag-on`; `--label <label>` reads the newest under
one label, and a reading with no label is `1`. Recording needs the suite set
up with `@variance-authority/sense`. When `story` answers `no story in this checkout`
after such a run, check that the test ran and was not skipped. If it did, the
project does not record stories: answer from the source, say the route was not
read from a story, and do not record more tests to find one.

A story is the code as it was when the test ran. After an edit to the test, to
any file on its route, or to its mocks or config, run the test again with the
variable before you quote its story.

Then read it:

```bash
variance story --name "removes the last item"
variance story --file src/cart.test.ts --name "removes" --format json
```

`--file` and `--name` match text the test file path and the test name contain.
When they match several tests, the answer lists them with their visit counts
and readings and prints no route; narrow the text and ask again.

The answer fits a page. It is drawn at the finest level that fits in 5,000
characters — every step, then steps with other workspace packages passed
through, then declarations, files, packages — and the header names the level
and how long the next one down would be. A short test comes back step by step,
with a key for the marks and each step's branches and loops drawn as the code
nests them:

```text
  1  Cart/removeItem  cart.ts:13-23
       if 14  then ✗  else ×1
  2  Cart/removeItem/filter.arg0  cart.ts:17 ×3
     steps 3-5 ran 2 times in all:
  3    Cart/removeItem  cart.ts:13-23
         if 14  then ✗
         for 18 ×2
  4    applyTier  price.ts:6-9 ×2
         if 7  then ×1  else ×1
  5    formatPrice  format.ts:14-18 ×2
  6  Cart/removeItem  cart.ts:13-23
       if 14  then ✗
  7  Cart/notify  cart.ts:25-27
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
- `before the test` is the code the runner ran outside the test just before
  it, such as code a `beforeEach` or the previous test's `afterEach` called.
  Test files are not recorded by default, so the hook itself is not a step.
- At the declarations level, `steps 36, 39×6` lists each step the function was
  at; `39×6` is step 39, repeated six times, as calls or returns.
- `» text` under a step is a line the code said at that step: a `console` line
  as `console.log …`, an Eyes entry as `eyes …` with a query's arguments and
  what it found, a `vae` announcement as `vae …`. Lines said before the first
  step are in the header.

## Compare readings

```bash
variance story --name "saves the total it charges" --compare outcome   # passed against threw
variance story --name "saves the total it charges" --compare last      # newest against the one before
variance story --name "saves the total it charges" --compare 1,flag-on # two labels
```

```text
compare  src/checkout.test.ts > saves the total it charges
  passed (4 readings) against threw (6 readings, every one threw)

  only when it passed, on every reading:
    went into  checkout  src/checkout.ts:10-16, the else of the if on 13
    said       » console.log charged 450, saved 450

  only when it threw, on every reading:
    went into  checkout  src/checkout.ts:10-16, the then of the if on 13
    said       » console.log charged 450, saved 500

  in the opposite order when it passed and when it threw, on every reading:
    applyTier  src/price.ts:6-9
      before » console.log saving when it passed, after it when it threw

  left out, because they differ between readings of one side as well: 1 place, 4 lines said, 37 pairs in changing order
```

- A listed difference is true of every reading on one side and of no reading
  on the other. That is the lead: open the place it names.
- The last line counts what differs between readings of one side too. It is
  not the cause; do not read it as one, and do not report the order changing
  between runs as a flake.
- *one reading on a side* means the comparison cannot tell the side from the
  run. `last` always says it. Record the test again under each side before you
  conclude.
- *nothing separates the sides* means the difference is in a value no line
  prints, or in code that is not instrumented. Add a `console.log` of the value
  you suspect, record both sides again, and compare again.

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

A story covers the test's own process, under Vitest, Jest and Rstest. A test
run in a browser page (Vitest browser mode) or by Playwright writes none, and
code the test calls in another process, such as a server, is not on it.
