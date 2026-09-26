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

Then read it, overview first:

```bash
variance story --name "removes the last item"
variance story --file src/cart.test.ts --name "removes" --format json
```

`--file` and `--name` match text the test file path and the case name contain.
When they match several stories, the answer lists them with their visit counts
and prints no route; narrow the text and ask again.

The overview names each file in the order the case first reached it, and each
declaration in it with the steps the case was there. A step is one stop on the
route, numbered in order. It is the cheap read: it tells you which files matter
before you spend context on the route itself.

```text
story  src/cart.test.ts > cart > removes the last item
  goes through 4 files in 7 steps

  src/cart.test.ts
    3-8  beforeEach.arg0  step 1

  src/cart.ts  loaded at step 2
    12-30  Cart/removeItem  steps 3, 6
    33-35  Cart/notify  step 7

  src/price.ts  loaded at step 2
    6-8  applyTier  step 4, in a loop

  src/format.ts  loaded at step 2
    14-19  formatPrice  step 5, in a loop
```

Then read only the part you need — one of:

```bash
variance story --name "removes the last item" --in price.ts   # the steps through these files, one either side
variance story --name "removes the last item" --around 6      # three steps either side of step 6
variance story --name "removes the last item" --whole         # every step
```

```text
     … steps 1-2
  the case
  3  src/cart.ts:12-30  Cart/removeItem
     repeats
  4    src/price.ts:6-8  applyTier
  5    src/format.ts:14-19  formatPrice
  6  src/cart.ts:12-30  Cart/removeItem
  7  src/cart.ts:33-35  Cart/notify
```

- A step is a declaration — a function, a handler, a module's top level — at
  `file:start-end`, named by its path in the file. Consecutive visits inside
  one declaration are one step; a return to the caller is a step of its own.
- `… steps 1-2` is what this part leaves out. Ask `--around` a step at its edge
  to read further.
- `repeats` is a loop, drawn once. How many times it went round is not printed.
- `loaded N files` is modules evaluated one inside another; each file is named
  once.
- `before the case` is what the runner ran outside the case just before it:
  `beforeEach`, the previous case's `afterEach`.

The step before another is where the case came from, not its caller. The tape
holds which regions ran, not calls and returns, so no step names a parent; the
step numbers are what join two parts you read.

The route is a map. It does not say which arm of an `if` ran or how many times
a loop went round; use a debugger for that. What the route could not draw, it
says in the header:

- *drawn as the file alone* — the recording holds no regions for that file at
  this text. `yarn test` records them.
- *the tape filled* — the visits after the limit are not on the route.
- *another case's work ran in the middle of this one* — under a runner that
  tracks cases through async context, that work is left out.
- *the case threw or rejected* — the route ends where it stopped.

A case run in a page (browser mode) and a service head write no story.
