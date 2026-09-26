# Where one test goes, in order

`variance story` is the question to ask before reading the code one test goes
through. `covering` names the tests that ran a line; this names the places one
test ran, in the order it ran them, so you open the files it goes through
instead of guessing. It reads no config.

A run writes a story only when asked. Set the variable and narrow the run with
the runner's own filter — every case the run runs writes one, and a later run
of the same case replaces it:

```bash
VARIANCE_AUTHORITY_STORY=1 yarn vitest run src/cart.test.ts -t "removes the last item"
VARIANCE_AUTHORITY_STORY=1 yarn jest src/cart.test.ts -t "removes the last item"
```

Then read it:

```bash
variance story --name "removes the last item"
variance story --file src/cart.test.ts --name "removes" --format json
```

`--file` and `--name` match text the test file path and the case name contain.
When they match several stories, the answer lists them with their visit counts
and prints no route; narrow the text and ask again.

The answer fits a page. It is drawn at the finest level that fits in 60 lines —
every step, then steps with other workspace packages passed through, then
declarations, files, packages — and the header names the level and how long
the next one down would be. A short case comes back step by step:

```text
story  src/cart.test.ts > cart > removes the last item
  goes through 4 files in 7 steps

  before the case
  1  src/cart.test.ts:3-8  beforeEach.arg0
  the case
  2  loaded 3 files: src/cart.ts, src/price.ts, src/format.ts
  3  src/cart.ts:12-30  Cart/removeItem  if#0/else 16-17, for#0/body 18-22 ×2
     repeats ×2
  4    src/price.ts:6-8  applyTier ×2  if#0/then 7
  5    src/format.ts:14-19  formatPrice ×2
  6  src/cart.ts:12-30  Cart/removeItem  for#0/after 24-29
  7  src/cart.ts:33-35  Cart/notify
```

A long one opens coarser, and the header says how to go finer:

```text
  drawn by declarations: by every step it is 145 lines, over the 60 a reading is held to;
  narrow it with --in <package or file> or --around <step>, or read every step with --whole
```

Narrow to the part you need, and the level is picked again inside it:

```bash
variance story --name "removes the last item" --in price.ts   # the steps through these files, one either side
variance story --name "removes the last item" --in @acme/ui   # the steps through a package, opened
variance story --name "removes the last item" --around 6      # three steps either side of step 6
variance story --name "removes the last item" --whole         # every step, however long
```

- A step is a declaration — a function, a handler, a module's top level — at
  `file:start-end`, named by its path in the file. Consecutive visits inside
  one declaration are one step; a return to the caller is a step of its own.
- After the declaration come the arms it took, with their lines and `×N` when
  more than once: `if#0/else 16-17, for#0/body 18-22 ×2`. `×N` after the
  declaration itself is how many times it was entered.
- `repeats ×N` is a loop, drawn once; the arms and counts under it are all its
  passes added together.
- `through <package>, steps a-b: names` is a run of steps inside a workspace
  package other than the test's own. Open it with `--in <package>`.
- `… steps 1-2` is what this part leaves out. Ask `--around` a step at its edge
  to read further.
- `loaded N files` is modules evaluated one inside another; each file is named
  once.
- `before the case` is what the runner ran outside the case just before it:
  `beforeEach`, the previous case's `afterEach`.

The step before another is where the case came from, not its caller. The tape
holds which regions ran, not calls and returns, so no step names a parent; the
step numbers are what join two parts you read.

The route is a map. It does not give the order of every visit inside a step or
how each pass of a loop differed; use a debugger for that. What the route could
not draw, it says in the header:

- *drawn as the file alone* — the recording holds no regions for that file at
  this text. `yarn test` records them.
- *the tape filled* — the visits after the limit are not on the route.
- *another case's work ran in the middle of this one* — under a runner that
  tracks cases through async context, that work is left out.
- *the case threw or rejected* — the route ends where it stopped.

A case run in a page (browser mode) and a service head write no story.
