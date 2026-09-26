# Read the route one test takes

A **test story** is the order one test case went through your code: the
functions it called, the modules it loaded, and the loops it went round, drawn
as a route you read before you open a file. A [journey](journeys.md) says which
code a case ran. A test story says in what order. You ask for one when you are
about to change code for one test, or when an agent is, and you want to know
which files that test goes through without opening them one by one.

[Wallaby.js](https://wallabyjs.com/docs/features/test-stories/) shows the same
thing in an editor while a test runs. Here it is written by your own runner,
into [the cache](cache.md), and read with one command.

## Write one

Set `VARIANCE_AUTHORITY_STORY=1` and run the case with your runner's own
filter:

```bash
VARIANCE_AUTHORITY_STORY=1 yarn vitest run src/cart.test.ts -t "removes the last item"
```

Every case the run runs writes its test story, and a later run of the same case
replaces it. The Vitest, Jest and Rstest integrations of
[Sense](../packages/sense/README.md) write them, from the same instrumented
build that records journeys. Nothing else changes: the recording a run writes
with the variable is byte for byte the recording it writes without it, and a run
without the variable does not tape anything.

## Read it

```bash
variance story --name "removes the last item"
```

`--file` and `--name` match text in the test file path and the case name. A
short case is read step by step. Each step is the declaration the case was in,
and under it the branches and loops it went through there, drawn as the code
nests them:

```text
story  src/cart.test.ts > cart > removes the last item
  goes through 4 files in 7 steps
  key  step   one declaration, from entering or coming back to it until the case goes on to another
       ×N     beside a declaration, times it was entered at that step; beside an arm or a loop, times it ran
              there; under `steps a-b ran N times`, every pass of them is added
       ✗      an arm the case never took, or a loop whose body never ran
       ↑      an arm or a loop body entered at an earlier step, which this step runs inside
       in 255 then:  inside the `then` arm of the `if` on line 255

  in src: cart.test.ts, cart.ts, price.ts, format.ts

  before the case
  1  beforeEach.arg0  cart.test.ts:3-8
  the case
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

- **A step** is one stop on the route, numbered in the order the case reached
  it. A declaration is named by where it is declared in its file:
  `Cart/removeItem` is the `removeItem` method of `Cart`, and `beforeEach.arg0`
  is the callback passed to `beforeEach`. Files are named by the shortest end
  of their path that tells them apart, and the line above the route says which
  directory each is in.
- **`if 14  then ✗  else ×1`** is one `if`, named by the line it starts on,
  with both of its arms and how many times each ran. `for 18 ×2` is a loop
  whose body ran twice. A `switch` names each case by its line, a `try` names
  its `catch` and `finally`, and an `await` is drawn by its line alone.
- **`✗`** is an arm the case went into nowhere: not at this step, not at any
  other, not before the case. Whatever those lines do, this case does not
  protect it. An `else` nobody wrote is drawn like any other, so `then ×6  else
  ✗` is a condition that held every time.
- **What sits inside one arm** is drawn under its construct and names the arm,
  `in 255 then: if 257  then ✗  else ×4`, so you read the nesting off the words
  rather than off a column.
- **`↑`** is an arm entered at an earlier step that this step runs inside: the
  step between was a call made from within it.
- **`steps 4-5 ran 2 times in all:`** is a loop, drawn once with the steps of
  one pass under it. Passes that took different arms are still one loop, and
  their counts add: `applyTier ×2` with `then ×1  else ×1` is two entries, one
  through each arm.
- **`loaded 3 files: …`** is modules evaluated one inside another, each file
  named once.
- **`before the case`** is what the runner ran outside the case just before it,
  such as `beforeEach`.

Visits in a row inside one declaration are one step. A return to the caller is
a step of its own, which is why `Cart/removeItem` is step 3 and step 6. Step 6
went on past the loop, and going on past a construct is what it does, so it
draws nothing but the arm the case never took. The step before another is
where the case came from, not its caller: the tape holds which regions ran, not
calls and returns, and a function that returns without entering another region
leaves nothing to join on.

### A long case opens on its table of contents

A case that goes through hundreds of declarations does not fit on a page, and
you rarely need all of it. So the reading is drawn at the finest level that fits
in 5,000 characters, and says which level it chose and how long the next one
down is:

| Level | One line for |
|---|---|
| packages | each workspace package the case went through, with its steps |
| files | each file, grouped by package |
| declarations | each declaration, under its file, with its steps |
| steps | each step, with other packages passed through |
| every step | each step |

This is the largest case in this repository's own suite, 116 steps drawn by
declarations:

```text
story  packages/core/src/relate/merkle.test.ts > the closure digest > calls a new node changed rather than absent
  goes through 5 files in 116 steps
  drawn by declarations, because by every step it would be 11712 characters, over the 5000 a reading is held to;
  narrow it with --in <package or file> or --around <step>, or read every step with --whole
  key  step   entering a declaration or coming back to it; 39×6 is step 39, which came round 6 times

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
what to ask for next. Branches and loops are drawn only when steps are: on a
table of contents they would be most of the page.

### Other packages are passed through

A case in an application goes through the workspace's other packages: a design
system, a utility library. When a reading is drawn by steps, the steps in a row
inside a package other than the test's own are one line, naming the package,
the steps and the declarations they were at. The package is the nearest
`package.json` above the file.

```text
story  src/checkout.test.tsx > checkout > pays
  goes through 6 files in 268 steps
  drawn by steps, because by every step it would be 7240 characters, over the 5000 a reading is held to;
  narrow it with --in <package or file> or --around <step>, or read every step with --whole
  passed through @acme/ui, a line for each run of steps; open one with --in <package>
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
are drawn like your own.

`--format json` gives the same answer as data: the reading with its `level`,
the size of the next level down in characters as `finer`, and, when steps are
drawn, the arms their declarations never went into as `untaken`. When the text
matches several cases, you get the list of them instead, and you narrow the
text.

## What the route leaves out

The route is drawn from a tape of every region the case ran, in order, and it
does not show all of that tape:

- **The order inside a step.** The arms of a step are drawn in the order the
  code holds them, not in the order of every visit.
- **How each pass differed.** A loop is drawn once, with the arms and counts of
  all its passes added together.
- **Another case's work.** When a runner tracks cases through async context and
  another case's work runs in the middle of this one, that work is left out, and
  the header says how many times it happened.

The header also says when the tape filled before the case ended, when the case
threw, and which files it draws as the file alone because the recording has no
regions for them at this text. `yarn test` records them.

A case run in a browser page and a service process write no test story.

## What a test story is not

Nothing selects on a test story or compares it. Selection and comparison read
journeys, which are sets and are true under `async`. A test story is true for
one case in one process, in the order that process ran it, and it claims no
call stack: two awaits of one case appear where they ran.
