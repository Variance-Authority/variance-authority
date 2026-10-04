# Read what one test ran, in order

A **test story** is the order one test ran its code in, written out as
numbered steps: each function the test ran, the branch it took at each `if`,
how many times each loop ran, and the lines the code printed. Every run already
records which code each test ran. A story adds the order, the counts and the
printed lines, and you read it from top to bottom.

## What you already know, and what you do not

With [Sense](../packages/sense/README.md) set up for your runner, every run
records which code each test ran: each function, branch and loop body, as ran
or not ran. That record is the test's [journey](journeys.md), and every run
records one for every test. [`variance
covering`](test-level-coverage.md#the-process) reads the journeys and names the
tests that ran a function:

```bash
variance covering --file src/cart.ts --function removeItem
```

A journey is a set. It records that a test ran `removeItem`, `applyTier` and
`formatPrice`, and which of their branches it took. It does not record in what
order the test ran them, how many times, or what the code printed on the way.
Two questions need that:

- **What does this test do with the code I am about to change?**
- **Why does this test fail on some runs and pass on others?**

Without a story, you find the order in one of two ways:

- **Read the files.** You open each file, find the function, work out which
  function this one calls next, and remember the steps so far while you open the
  next one. When you are interrupted, you start again from the test.
- **Step through it in a debugger.** You see the values, but one line at a
  time, and only the part you step through. A test that fails one run in five
  usually passes under the debugger.

A test story is that order, recorded while the test runs and written out as
numbered steps. Each step names the file and the lines it ran, so you can read
from the top to see what the test does, or go straight to one step to see
which steps ran before it. The figure shows one test both ways: file by file,
and as its story.

The format and the name come from [Wallaby.js](https://wallabyjs.com/docs/features/test-stories/),
which shows a test story inside your editor. Here your own test runner records
it, under Vitest, Jest or Rstest, and you read it with one command, in a
terminal or in any editor.

## What does this test do with the code you are changing?

Say you want to change what `removeItem` does when the cart is already empty.
This is the method, from line 13 to line 23 of `src/cart.ts`:

```ts
  removeItem(id: string): void {
    if (this.items.length === 0) {
      throw new Error('the cart is empty');
    }
    this.items = this.items.filter((item) => item.id !== id);
    for (const item of this.items) {
      const cents = applyTier(item.cents, item.quantity);
      this.lines.push(formatPrice(cents));
    }
    this.notify();
  }
```

`variance covering` names `removes the last item` as a test that runs
`removeItem`, and from its name it looks like it checks the empty cart:

```ts
it('removes the last item', () => {
  cart.removeItem('C3');
  expect(cart.lines).toEqual(['5.00', '2.70']);
});
```

Its journey already records that the test never took the `then` on line 14, the
empty-cart branch. It does not record what the test did instead. Run the test once
with `VARIANCE_AUTHORITY_STORY=1`, and `variance story` from [the
CLI](../packages/cli/README.md) prints that, step by step:

```bash
VARIANCE_AUTHORITY_STORY=1 yarn vitest run src/cart.test.ts -t "removes the last item"
variance story --name "removes the last item"
```

In the output, `✗` is a branch the test never took, and `×2` is how many times
something ran:

```text
story  src/cart.test.ts > cart > removes the last item
  goes through 3 files in 7 steps

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

Each step is one function the test ran, named by where it is declared:
`Cart/removeItem` is the `removeItem` method of `Cart`, and
`Cart/removeItem/filter.arg0` is the callback passed to `filter` inside it.
Under a step are the branches and loops the test ran there. Read it from the
top:

- **Step 1.** The test called `removeItem`. The condition on line 14 was
  false, so it skipped the `throw`.
- **Step 2.** The callback passed to `filter` ran three times, once for each
  item.
- **Steps 3 to 5.** The loop on line 18 ran twice. Each pass went from
  `removeItem` to `applyTier` and then to `formatPrice`, so the three steps are
  shown once, with the counts of both passes added.
- **Steps 6 and 7.** After the loop, the test continued in `removeItem` and
  ended in `notify`.

So the test that looks like it checks the empty cart removes one item from
three, reprices the two that are left and notifies. The cart is never empty,
so the `then` on line 14 is `✗` at all three steps in `removeItem`. Whatever
you write in that branch, this test passes, so you write a test for the empty
cart before you change it.

## Why does this test fail on some runs?

Say the test `saves the total it charges` fails on some runs. It calls
`checkout` in `src/checkout.ts`, which saves the order and reprices it at the
same time, then checks that it saved the total it charges:

```ts
export async function checkout(order: Order): Promise<void> {
  await Promise.all([save(order), reprice(order)]);
  console.log(`charged ${order.total}, saved ${order.saved}`);
  if (order.saved !== order.total) {
    throw new Error(`saved ${order.saved}, charged ${order.total}`);
  }
}

async function save(order: Order): Promise<void> {
  await wait();
  console.log('saving');
  order.saved = order.total;
}

async function reprice(order: Order): Promise<void> {
  await wait();
  order.total = applyTier(order.total, 2);
}
```

A story lists each line the code prints under the step that printed it, after
`»`. This is the end of the story of a run that failed:

```text
   8  save  checkout.ts:18-22
        await 19 ×1
        » console.log saving
   9  reprice  checkout.ts:24-27
        await 25 ×1
  10  applyTier  price.ts:6-9
        if 7  then ×1  else ✗
  11  checkout  checkout.ts:10-16
        await 11 ×1
        if 13  then ×1  else ✗
        » console.log charged 450, saved 500
```

The journeys of the runs that failed differ from the runs that passed only at
the `if` on line 13. That shows what happened, not why.

**One story does not show why either.** Code after an `await` runs when its promise
settles, and two promises started together settle in either order, so an async
test can run in a different order on each run, including runs that pass. Put
two stories side by side and most of what differs is not the cause.

### Compare readings of one test

Each run of a test writes one story, and the cache keeps the stories of a
test's last 16 runs. The output calls each kept story a **reading**. Record the test until
it has both passed and failed, two or three times each, then compare:

```bash
variance story --name "saves the total it charges" --compare outcome
```

`--compare outcome` puts the readings in two groups, the runs that passed and
the runs that threw. It lists only what is true of every reading in one group
and of no reading in the other:

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
```

This output shows three things, and each one names a place to open:

- **Which branch the test took.** Every run that failed took the `then` of the `if`
  on line 13, which throws, and no run that passed did.
- **What the code printed.** Every run that failed saved 500 and charged 450,
  and every run that passed saved 450.
- **In what order.** On every run that passed, `applyTier` ran before `save`
  printed `saving`, and on every run that failed, after it. That is the cause:
  `save` stores the total before `reprice` changes it.

The comparison can also answer in three other ways:

- **A last line counts what it left out**, such as `left out, because they
  differ between readings of one side as well: 1 place, 4 lines said, 37 pairs
  in changing order`. Those differ between runs that passed too, so none of
  them is the cause. They are what you would read through if you compared two
  stories by hand.
- **`nothing separates the sides`** means the runs ran the same code,
  printed the same lines, and ran in the same order wherever every run had
  one order. The difference is in a value nothing prints, or in code that is not
  recorded, such as a dependency. Print the value you suspect with
  `console.log`, and record again.
- **With one reading in a group**, the comparison cannot distinguish what the group
  does from what that one run happened to do, and it prints that under its
  first line. Record the test again. The runs you made earlier still count.

### Choose the sides

The output calls each group a side. A side is either the same test read again,
where only the run differs, or a setup you chose, where you name what differs:

| `--compare` | One side | The other side | What differs |
|---|---|---|---|
| `outcome` | the readings that passed | the readings that threw | nothing you chose: the run |
| `last` | the newest reading | the reading before it | the run, and anything you edited between the two |
| `<a>,<b>` | the readings labelled `a` | the readings labelled `b` | what you set up differently for each label |

You label a run by setting `VARIANCE_AUTHORITY_STORY` to a name in place of
`1`. Use labels for a test that passes alone and fails with its file, a feature flag on and off,
or two versions of a dependency. For a test that passes alone and fails with
its file, record each setup twice under its own label, then compare the labels:

```bash
VARIANCE_AUTHORITY_STORY=alone yarn vitest run src/cart.test.ts -t "removes the last item"
VARIANCE_AUTHORITY_STORY=file yarn vitest run src/cart.test.ts
variance story --name "removes the last item" --compare alone,file
```

`before the test`, at the top of each story, shows the code the runner ran right before the
test, such as code another test's `afterEach` called.

`--compare last` is always one reading against one, so use it to see what an
edit changed, not to explain a test that fails on some runs.

## Why the journey has no order

The journey and the story answer different questions, so a run keeps them
differently:

- **The journey is kept for every test, on every run.** Test selection and
  `variance covering` need it for every test. Two runs that ran the same code
  in a different order have one journey, so the order async code happens to
  run in does not change which tests [test
  selection](coverage-test-selection.md#what-the-record-keeps) runs.
- **The story is written only when you ask**, for the tests you name. Keeping
  the order adds work to every function the test runs, and a story for every
  test. Setting `VARIANCE_AUTHORITY_STORY` does not change the journeys: the
  record the run keeps is the same, byte for byte, as without the variable.

## When to record one

You understand most tests by reading them and the code they call. Record a
story when the code does not answer your question:

- **You are about to change code you do not know.** The journey names the
  code a test ran. When the call goes through an interface, a plugin, or a
  handler registered in another file, the source does not show the order it
  ran in. Ask [`variance covering`](test-level-coverage.md#the-process) which
  tests run the function, and read the stories of the first few it names.

  ```bash
  variance covering --file src/cart.ts --function removeItem
  ```

- **A test gives a result you do not expect, and nothing names the cause.** A
  failed assertion names the line in the test, not the code that made the
  value. Find the step where the story differs from the path you expected. A
  test that passes when it should not may have its branch marked `✗`, or run a
  mock and not the code it names.
- **A test fails on some runs, or fails with its file and passes alone.** Record it both ways
  and [compare the readings](#compare-readings-of-one-test).
- **You hand one test to an agent to fix or extend.** The story gives it the
  steps in order, each with its file and lines, so it reads those and not the whole package.

## When not to record one

Recording adds work to every function the test runs, and writes a story
for every test in the run. For the one test you are looking into, the run takes
about as long as without it. For many tests the run is slower, and the stories are
large.

- **Not the whole suite, not a package, and not in CI.** A run records every
  test it runs, so a run given a directory, a pattern or nothing records all of
  them. Name one test file, and a test name when you have one.
- **Not to find which tests run a line.** That question does not need the order.
  `variance covering` answers it from the journeys every run already keeps.
- **Not a performance test or a benchmark.** A loop that runs many thousands of
  times runs many times slower while it is recorded, and a story has counts,
  not times. Use a profiler for time.
- **Not when a stack trace already names the line.** Open that line.

## Record one

A story comes from the same recording as the journeys, so your suite needs
Sense set up for its runner first. Then set
`VARIANCE_AUTHORITY_STORY=1` and name the tests with your runner's own
arguments, one test or one file:

```bash
VARIANCE_AUTHORITY_STORY=1 yarn vitest run src/cart.test.ts -t "removes the last item"
VARIANCE_AUTHORITY_STORY=1 yarn jest src/cart.test.ts -t "removes the last item"
```

- **Where stories are kept.** In [the cache](cache.md), under
  `coverage.stories/`. A story is removed 14 days after it was written, with
  [the rest of the cache](cache.md#what-is-removed-and-when).
- **Which one you read.** `variance story` shows the newest reading, and its
  header prints how many are kept. `--label <name>` shows the newest under one
  label.
- **When to record again.** A story is the code as it was when the test ran.
  After you edit that code, run the test again before you read its story.
- **As data.** `--format json` gives any story or comparison as JSON.

## A long story opens as a summary

A test that goes through hundreds of functions does not fit on a page, and you
do not need all of it. So a long story opens as a summary, at the finest level
that fits one page: each function once, with the numbers of the steps it was
at, or each file, or each package. The header prints that, and how to open the
part you want:

```text
story  src/checkout.test.ts > checkout > pays with a saved card
  goes through 14 files in 116 steps
  drawn by declarations: by every step it would be 11712 characters, and a story is kept under 5000;
  narrow it with --in <package or file> or --around <step>, or read every step with --whole
```

Then you ask for the part you need, and that part opens at the finest level
that fits:

```bash
variance story --name "pays with a saved card" --in price.ts   # the steps through one file or package
variance story --name "pays with a saved card" --around 40     # three steps either side of step 40
variance story --name "pays with a saved card" --whole         # every step, however long
```

When steps inside another workspace package, such as your design system, are
shown as one line, that line names the package, and `--in` opens it.

## What the code prints

A step shows which code ran, not the values it had. The lines the code
prints are what give the values, and three sources write them under their step:

- **`console`.** Each line printed with `console.log`, `info`, `warn`, `error`
  or `debug`. The console still prints it.
- **[Eyes](eyes.md)**, when your tests use it. Each query with its arguments and
  what it found, each event and the element it fired on, each React commit with
  the components that rendered, and each Arrange, Act and Assert phase you mark.
- **[`vae`](../packages/event/README.md)**, when your product code uses it.
  Each announcement it makes.

So when you need to know which value a call got, add a `console.log` that
prints it, record the test again, and read the line at its step. A step shows
its first 5 lines and counts the rest.

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
  the code that ran just before it, not always its caller, and code after an `await`
  appears where it ran, not under the call that started it.

The header prints when a story is incomplete, and why:

- The recording filled up before the test ended.
- The test printed more than the 4,096 lines a story keeps.
- The test threw, and the story ends where it stopped.
- Another test's work ran in the middle of this one, and was left out.
- A file is shown by name alone, because it changed since the test ran. Run
  the test again.
