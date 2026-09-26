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
short case is read step by step, each step the declaration the case was in and
the branch arms it took there:

```text
story  src/cart.test.ts > cart > removes the last item
  goes through 4 files in 7 steps
  `never` names what a declaration holds that the case went into nowhere, before the case or during it

  before the case
  1  src/cart.test.ts:3-8  beforeEach.arg0
  the case
  2  loaded 3 files: src/cart.ts, src/price.ts, src/format.ts
  3  src/cart.ts:12-30  Cart/removeItem  if#0/else 16-17, for#0/body 18-22 ×2  never if#0/then 14-15
     repeats ×2
  4    src/price.ts:6-8  applyTier ×2  if#0/then 7
  5    src/format.ts:14-19  formatPrice ×2
  6  src/cart.ts:12-30  Cart/removeItem  for#0/after 24-29
  7  src/cart.ts:33-35  Cart/notify
```

- **A step** is one stop on the route, numbered in the order the case reached
  it. A declaration is named by where it is declared in its file:
  `Cart/removeItem` is the `removeItem` method of `Cart`, and `beforeEach.arg0`
  is the callback passed to `beforeEach`.
- **`if#0/else 16-17, for#0/body 18-22 ×2`** is the arms the case took inside
  the declaration, with their lines, in the order it first took them. `×2` is
  how many times: here the loop body ran twice and the `else` once.
- **`never if#0/then 14-15`** is what the declaration holds that the case went
  into nowhere: not at this step, not at any other, not before the case. It
  sits on the first step the declaration is drawn at. Whatever those lines do,
  this case does not protect it. An arm inside one already listed is left out,
  and an `else` nobody wrote is listed like any other, so `never if#0/else`
  says the condition held every time.
- **`repeats ×2`** is a loop, drawn once with the steps of one pass under it.
  Passes that took different arms are still one loop, and their counts add:
  `applyTier ×2  if#0/then 7` is two entries, one of them through the `then`.
- **`loaded 3 files: …`** is modules evaluated one inside another, each file
  named once.
- **`before the case`** is what the runner ran outside the case just before it,
  such as `beforeEach`.

Visits in a row inside one declaration are one step. A return to the caller is
a step of its own, which is why `Cart/removeItem` is step 3 and step 6, and step
6 names only the arms after the loop. The step before another is where the case
came from, not its caller: the tape holds which regions ran, not calls and
returns, and a function that returns without entering another region leaves
nothing to join on.

### A long case opens on its table of contents

A case that goes through hundreds of declarations does not fit on a page, and
you rarely need all of it. So the reading is drawn at the finest level that fits
in 60 lines, and says which level it chose and how long the next one down is:

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
  drawn by declarations: by every step it is 145 lines, over the 60 a reading is held to;
  narrow it with --in <package or file> or --around <step>, or read every step with --whole

  packages/core/src/format/hash.ts
    31-33  digestString  steps 1, 40, 47, 56, 95, 102, in a loop
    77-79  digestCombine  steps 46, 101, in a loop
  …
```

Then you read the part you care about, and the level is picked again inside it:

- `--in <package or file>` gives the steps through the files whose path contains
  the text, or the files of the package named, with one step either side.
- `--around <step>` gives the three steps either side of one.
- `--whole` gives every step, however long.

A part that leaves steps out says so with a line like `… steps 1-2`, so you
know what to ask for next. What a declaration never went into is drawn only when
steps are: on a table of contents it would be most of the page.

### Other packages are passed through

A case in an application goes through the workspace's other packages: a design
system, a utility library. When a reading is drawn by steps, the steps in a row
inside a package other than the test's own are one line, naming the package,
the steps and the declarations they were at. The package is the nearest
`package.json` above the file.

```text
story  src/checkout.test.tsx > checkout > pays
  goes through 6 files in 68 steps
  drawn by steps: by every step it is 69 lines, over the 60 a reading is held to;
  narrow it with --in <package or file> or --around <step>, or read every step with --whole
  passed through @acme/ui, a line for each run of steps; open one with --in <package>

   1  src/checkout.tsx:10-60  Checkout
   2  through @acme/ui, steps 2-41: Button, Icon, useTheme
  42  src/checkout.tsx:40-52  Checkout/onPay  if#0/then 42-44
  43  through @acme/ui, steps 43-67: Button, Icon, useTheme
  68  src/pay.ts:3-20  pay
```

A step back in your own package ends the line, so a callback into the
application stays on the route. `--in @acme/ui` opens the package, and its steps
are drawn like your own.

`--format json` gives the same answer as data: the reading with its `level`,
the size of the next level down as `finer`, and `never` on the step that draws
it. When the text matches several
cases, you get the list of them instead, and you narrow the text.

## What the route leaves out

The route is drawn from a tape of every region the case ran, in order, and it
does not show all of that tape:

- **The order inside a step.** The arms of a step are listed in the order the
  case first took each one, not in the order of every visit.
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
