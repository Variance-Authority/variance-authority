# Test-level coverage

Ordinary coverage is a union: every region some test covered, with nothing left
saying which test covered it. **Test-level coverage keeps the relation that
union was folded from** — for each named test case, the regions of your source
that case walked — so a line answers *which tests walk me* rather than *did
anybody*. It is what separates a question you can act on from a percentage you
can only watch, and on three public suites recording it added 2% to 8% to a run
where `--coverage` adds 26% to 30%.

## Record it, then ask

**Record it once.** The recorder wraps the configuration you already have and
keeps its plugins, setup files and reporters:

```ts
import { defineConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';

export default withTestSelection(
  defineConfig({ test: { include: ['test/**/*.test.ts'] } }),
);
```

**Run the suite the way you run it.** No separate coverage pass and no second
command.

**Ask.** From a shell, about a place. Line 5 of `src/cart/total.ts` is the
`HALF` branch of `applyDiscount`:

```bash
npx variance covering --file src/cart/total.ts --line 5
```

```text
1 named test covered line 5 of src/cart/total.ts, and it is the only case that could have:
  test/total.test.ts — 1/2
    halves the total with HALF
```

The same question about the whole function:

```bash
npx variance covering --file src/cart/total.ts --function applyDiscount
```

```text
2 named tests covered function applyDiscount of src/cart/total.ts:
  test/checkout.test.ts — 1/1
    ignores an unknown code
  test/total.test.ts — 1/2
    halves the total with HALF
```

**Ask about a change.** `npx variance covering --since main` asks the same
question about every region your branch changed. Over MCP,
`variance_source_tests` takes a location and `variance_changed_tests` takes the
diff the agent is already holding.

## What the union throws away

A merged report gives a line one bit. The relation behind it gives that line a
list, and the two differ on every question worth asking:

| the question in front of you | a merged report | the relation |
|---|---|---|
| is this branch tested? | yes | yes, by one case, and here is its name |
| is this other branch tested? | yes | yes, by fourteen cases across nine files |
| what should I run after this edit? | nothing | the cases that have been through these lines |
| why do all these tests exist? | nothing | the six that claim this function, by name |
| what did my change land on? | a number that moved | the changed regions nothing covered |

The first two rows are the point. **A region one case alone covered is evidence
standing on a single point, and a region fourteen cases cross is a hub** — and
a coverage percentage reports the two identically, at 100%, forever. The number
is not wrong. It is a projection that answers a question nobody is asking by
the time they are looking at a specific line.

The relation also keeps a distinction the union folds away: a test that was in
a region only while its module loaded is counted apart from a test that called
into it.

## What it changes

**Reviewing a change.** Point the relation at a diff and it reports every
changed region with the cases that covered it, and counts the two findings a
percentage cannot state: the regions nothing covered, and the regions one case
alone covered. That is [reviewing a change against what the code
did](agent-code-review.md).

**Deciding which tests to keep.** Point it at a line and it hands back the
named cases that walked it. Six tests claiming one function is where *why do
all of these need this code* starts having an answer, which is [own fewer
tests](own-fewer-tests.md). Coverage shows that the tests crossed the same code,
not that they protect the same promise; [on testing](on-testing.md#coverage-opens-the-question-it-does-not-close-it)
explains why that distinction controls any reduction.

**Making one test smaller.** A test's own crossings are the files it covered,
and the ones it covered without ever addressing anything in them are candidates
for a smaller boundary — the reading behind [distilling a
test](distill.md).

## You have seen this relation before

If you have used [Wallaby.js](https://wallabyjs.com/) you have already watched
it work. It instruments your source, keeps the matrix of which test covered
which region, and re-runs the minimal affected set as you type; per-test
coverage is not a new idea, and that is the deepest work anyone has done on it.

What has been missing is not the relation. It is a copy of the relation that
outlives the session that produced it. Wallaby's index belongs to a live
editor world on one developer's machine, kept valid from keystroke to
keystroke — it is not something a reviewer opens, a CI job reads, or an agent
holding a patch can query, and it says nothing to the person who never ran the
suite. Test-level coverage here is the same relation written down: a file an
ordinary run emits, that anything downstream can read without running
anything itself. One developer's editor knowing which tests walk a line is a
good day. The build knowing it is a different class of thing, because every
decision above depends on someone other than the author being able to ask.

## What you already believe this costs

You have turned coverage on in CI, watched the suite get slower, and turned it
off again. That reflex is right: a relation you record on every run is worth
nothing if recording it is the reason the suite stops being run.

The promise on the engine side is that coverage is free. V8 already keeps the
counters, Node exposes them through the inspector, and nothing rewrites your
code. The measured reality on three public suites, unmodified apart from the
configuration: Zod's 5,656 tests go from 8.87 s to 11.56 s under
`--coverage`, TanStack Query's 4,523 from 11.78 s to 15.25 s, and Material
UI's 7,456 from 25.88 s to 32.49 s. That is **+26% to +30%, on every run**,
and what it buys is the union — a percentage, and a file that cannot tell you
which test covered anything in it.

**Thirty percent is not one cost, because a percentage is not a unit.** On a
ten-second suite it is three seconds: it slows an agent loop slightly and
nobody sensibly cares. On a suite of three minutes it is a whole minute
back per run, and a minute is long enough to be worth spending somewhere
that returns more than a percentage. On the suite that takes fifteen, you
never see the 30% at all — sharding hides it, the wall clock stays roughly
where it was, and the cost moves onto the bill instead. At that end coverage
is not slower. It is **30% more money, every run, forever**, for a union.

The same three suites with the recorder installed are 9.05 s, 12.77 s and
26.76 s: **+2%, +8% and +3%**. Each figure is the median of five runs of the
whole suite, the first discarded as warm-up, with the caches cleared between
runs, on an Apple M4 Max with 64 GB and Node 26.
[Running less of the suite](selecting.md#what-recording-costs-while-the-suite-runs)
has the full table, and the unrecorded control runs that show how far the
machine itself varies. Those timings are the recorder writing the file-level
part of the record; the case axis adds one attribution for each region a case
ran. On Material UI pinned to two workers, where the suite takes a minute and a
half, `--coverage` adds **19.3 seconds** a run and recording adds **2.1**.

The record stays small enough to hand from one CI job to the next: the case axis
costs about half a byte for each region a case ran, 0.46 MB for 906,578 of them,
where one JSON object for each would be 27.2 MB. [Addressing
scale](scale.md#the-per-case-index) has the sizes on three projects.

What it costs *you* is not what it cost us:

- **Plan around +10%, and treat anything under that as luck.** How many
  regions a test crosses is a property of your code, not of the recorder, and
  a suite that spends most of its time in one hot module pays differently from
  one that spends it starting workers.
- **What those cycles buy is not a percentage.** It is the part worth putting
  on the other side of the comparison. A run under `--coverage` ends with a
  number. A run under the recorder ends with a dataset that says which tests
  have been through which lines, and that is the input to running fewer of
  them next time.
- **Measure both halves on your own suite.** Measure the overhead the way
  those figures were made — five runs with the recorder, five without,
  compare the medians — and then a selected run against the full one.

## Keep it current

**Re-record when the tree moves.** A region is a range of lines in the text the
suite ran over, so the index's coordinates belong to the commit it was recorded
at. An index behind the tree answers fluently about regions that have since
moved, which is worse than answering nothing; the `--since` reading measures
from the recorded commit for exactly this reason. At +2% to +8% there is no
budget argument against recording on every run, which is the cadence this
wants.

**Fold shards, don't fold axes.** A suite split across machines ends with one
index per shard, and folding them produces the union the unsharded run would
have written.

## What it still does not tell you

Execution says where a case went, never why the trip was worth taking. A test
with no assertions produces the same crossings as one that checks everything,
so fourteen cases on a region is the beginning of a question and not a verdict
on it.

There is no percentage here to put a threshold on, and that is a position
rather than a gap: a threshold over this relation would be a number that moves
when tests are added and says nothing about which region is standing on one
witness. The two findings are counts of named places, and a named place is
something you can open.

Crossings are whole-test. A region covered during a test's setup and a region
covered by the behaviour under test are both that test's crossings; the
phase-level reading is authored structure, which is [Eyes](eyes.md), and
`variance distill` is where the two are joined.

Nor does a crossing say what state the case ran under: a case whose mock
returns sale prices and one whose mock returns full prices cover the same line.
A case that says what it arranged has it on its row as a
[case precondition](case-preconditions.md), and `variance covering --where`
reads it.
