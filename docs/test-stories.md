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

`--file` and `--name` match text in the test file path and the case name:

```text
story  src/cart.test.ts > cart > removes the last item
  goes through 4 files

  before the case
    src/cart.test.ts:3-8  beforeEach.arg0
  the case
    loaded 3 files: src/cart.ts, src/price.ts, src/format.ts
    src/cart.ts:12-30  Cart/removeItem
    repeats
      src/price.ts:6-8  applyTier
      src/format.ts:14-19  formatPrice
    src/cart.ts:12-30  Cart/removeItem
    src/cart.ts:33-35  Cart/notify
```

Each line is one declaration at `file:start-end`: a function, a handler, or a
module's top level, named by where it is declared in its file — `Cart/removeItem`
is the `removeItem` method of `Cart`, and `beforeEach.arg0` is the callback
passed to `beforeEach`. Visits in a row inside one declaration are one line. A
return to the caller is a line of its own, which is why `Cart/removeItem`
appears again after the loop.

- **`repeats`** is a loop, drawn once with the steps of one pass under it.
- **`loaded 3 files: …`** is modules evaluated one inside another, each file
  named once.
- **`before the case`** is what the runner ran outside the case just before it,
  such as `beforeEach`.

`--format json` gives the same route as data. When the text matches several
cases, you get the list of them instead, and you narrow the text.

## What the route leaves out

The route is drawn from a tape of every region the case ran, in order, and it
does not show all of that tape:

- **Which arm ran.** A route names the declaration, not the `if` arm or the
  `case` inside it. The [execution record](execution-record.md) answers which
  regions ran.
- **How many times.** A loop is drawn once, however many passes it made.
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
