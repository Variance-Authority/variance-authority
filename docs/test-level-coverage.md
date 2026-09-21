# Test-level coverage

Ordinary coverage is a union: every region some test entered, with nothing left
saying which test entered it. **Test-level coverage keeps the relation that
union was folded from** — for each named test case, the regions of your source
that case walked — so a line answers *which tests walk me* rather than *did
anybody*. It is one axis added to a recording your suite can already make, and
it is what separates a question you can act on from a percentage you can only
watch.

## What the union throws away

A merged report gives a line one bit. The relation behind it gives that line a
list, and the two differ on every question worth asking:

| the question in front of you | a merged report | the relation |
|---|---|---|
| is this branch tested? | yes | yes, by one case, and here is its name |
| is this other branch tested? | yes | yes, by fourteen cases across nine files |
| what should I run after this edit? | nothing | the cases that have been through these lines |
| why do all these tests exist? | nothing | the six that claim this function, by name |
| what did my change land on? | a number that moved | the changed regions nothing entered |

The first two rows are the point. **A region one case alone entered is evidence
standing on a single point, and a region fourteen cases cross is a hub** — and
a coverage percentage reports the two identically, at 100%, forever. The number
is not wrong. It is a projection that answers a question nobody is asking by
the time they are looking at a specific line.

Two more distinctions survive the fold only if the axis is there. A case that
was inside a region **only while its module was evaluating** was present rather
than exercising anything, so it is counted apart from one that called in. And a
region **recorded but entered by nobody** is a different statement from a line
in no recorded region at all: the first is a hole, the second is a coordinate
the recording never claimed to cover.

## What it changes

**Reviewing a change.** Point the relation at a diff and it reports every
changed region with the cases that entered it, and counts the two findings a
percentage cannot state: the regions nothing entered, and the regions one case
alone entered. That is [reviewing a change against what the code
did](agent-code-review.md).

**Deciding which tests to keep.** Point it at a line and it hands back the
named cases that walked it. Six tests claiming one function is where *why do
all of these need this code* starts having an answer, which is [own fewer
tests](own-fewer-tests.md).

**Making one test smaller.** A test's own crossings are the files it entered,
and the ones it entered without ever addressing anything in them are candidates
for a smaller boundary — the reading behind [distilling a
test](distill.md).

**Not deciding what to skip.** Selection stays at file grain, deliberately: a
skip list is a question about test *files*, one entry per file, and the case
axis would cost a shared record several times its size to refine an answer
nobody reads. Test-level coverage explains; the file-level
[record](execution-record.md) selects. They are two axes of the same recording
and you choose per run which you are writing.

## The process

**Record it once.** The recorder wraps the configuration you already have and
keeps its plugins, setup files and reporters:

```ts
import { defineConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';

export default withTestSelection(
  defineConfig({ test: { include: ['src/**/*.test.ts'] } }),
  { cases: true },
);
```

**Run the suite the way you run it.** No separate coverage pass, no second
command, and the file-level snapshot the same run writes is byte-identical
whether or not you asked for cases — so whatever reads it in CI does not
change.

**Ask.** From a shell, about a place:

```bash
npx variance covering --file src/cart/total.ts --line 14
npx variance covering --file src/cart/total.ts --function applyDiscount
npx variance covering --since main
```

Or over MCP, where `variance_source_tests` takes a location and
`variance_changed_tests` takes the diff the agent is already holding.

**Re-record when the tree moves.** A region is a range of lines in the text the
suite ran over, so the index's coordinates belong to the commit it was recorded
at. An index behind the tree answers fluently about regions that have since
moved, which is worse than answering nothing; the `--since` reading measures
from the recorded commit for exactly this reason. Recording is cheap enough to
repeat: on two public suites the recording costs **1.02× and 1.08×** the plain
run, where `--coverage` on the same suites costs 1.29× to 1.30× — the
arithmetic behind that gap is in [running less of the
suite](selecting.md#what-recording-costs-while-the-suite-runs). Those figures
are the file-level axis; the case axis adds an attribution per crossing on top
of them, and the honest way to price it on your suite is the one that page
gives for the recorder: five runs with the flag, five without, compare the
medians.

**Fold shards, don't fold axes.** A suite split across machines ends with one
index per shard, and folding them produces the union the unsharded run would
have written.

## A bit of the technology

**A probe, not a profiler.** The recorder emits a counter write at each region
as your code is transformed, so what you pay tracks what your tests *ran*. The
engine's own coverage is not fired but read, and the read hands back every
script the worker had open — which is why reading native counters *per test*,
the only way to get this axis out of the profiler, costs 2.1× to 2.7× on a
jsdom suite and the probe costs a few percent.

**A region is a block, not a line.** What gets an id is a lexical block — a
function, a branch arm, a loop body, a handler — and what identifies it is its
address in the module's tree rather than its place in the module's text. So
inserting a function above it renumbers everything and retires nothing: a
crossing is dropped only when the new text has no region at that address. Line
numbers are coordinates *into* the recorded text, not the thing recorded.

**A crossing is a pair.** One row is *this case entered this region*, and the
index is those pairs and nothing else: three parallel integer columns, sorted
case-major, delta-coded and run-compressed. That is how nine hundred thousand
crossings fit in **0.46 MB — about half a byte each** — and why the same
relation spelled as JSON objects is 27.2 MB. The sizes at four scales are in
[addressing scale](scale.md#the-per-case-index-when-you-ask-for-it).

**The case axis is a sidecar.** It is written beside the record rather than
into it, because the shared durable record CI hands between jobs stays
file-level, and a case axis over every region of a very large repository costs
that file several times its size. Locally, where the recording spans what you
are actually running, it is a fraction of a megabyte.

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

Crossings are whole-test. A region entered during a test's setup and a region
entered by the behaviour under test are both that test's crossings; the
phase-level reading is authored structure, which is [Eyes](eyes.md), and
`variance distill` is where the two are joined.
