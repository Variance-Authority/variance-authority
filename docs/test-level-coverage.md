# Test-level coverage

Ordinary coverage is a union: every region some test covered, with nothing left
saying which test covered it. **Test-level coverage keeps the relation that
union was folded from** — for each named test case, the regions of your source
that case walked — so a line answers *which tests walk me* rather than *did
anybody*. It is one axis added to a recording your suite can already make, and
it is what separates a question you can act on from a percentage you can only
watch.

## What you already believe this costs

You have turned coverage on in CI, watched the suite get slower, and turned it
off again. That reflex is right, and it is the first thing to settle rather
than the last: a relation you record on every run is worth nothing if
recording it is the reason the suite stops being run.

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
26.76 s: **+2%, +8% and +3%**. The difference is not tuning, it is which way
the instrument faces. A probe fires when execution reaches it, so what you pay
tracks what your tests *ran*. The engine's counters are not fired but read, and
the read hands back every script the worker had open, whether a test went near
it or not.

Two of those suites are short enough that you should not believe a percentage
taken off them, and that objection is why the third is here. Every Material UI
round runs the suite plain, recorded, and plain again; the two plain arms come
out **0.1%** apart, so a 0.9 s recording cost is a signal rather than a warm
disk. Run the same suite on two workers, where it takes a minute and a half
instead of half a minute, and the two baseline arms land **0.02%** apart:
**91.56 s** plain against **93.69 s** recorded, and **110.86 s** under
`--coverage`. Recording does not grow with the clock, and at that length the
comparison stops being a ratio and becomes a number you can spend — **19.3
seconds a run for the union, 2.1 seconds for the relation**. (Medians, warm-up
discarded, both caches cleared between runs, on an Apple M4 Max, 64 GB, Node
26. The full table is in [running less of the
suite](selecting.md#what-recording-costs-while-the-suite-runs).)

Per test, the gap stops being a percentage and becomes the reason this axis
does not exist in your pipeline. Getting it out of the profiler means reading
the native counters between every test rather than once at the end, and that
costs 2.1× to 2.7× on a jsdom suite. Nobody pays that in CI, so nobody has the
relation in CI.

The second cost is the file, and it is the one that quietly decides whether a
thing survives contact with a build system. Spelled the obvious way — one
object per crossing, with field names — this relation measured 31 to 37 bytes
per crossing on three real projects: 27.2 MB of sidecar next to a 0.3 MB
record, against a CI artifact cap. Spelled as a dictionary, interned sets and
three parallel integer columns under run coding, the same 906,578 crossings
are **0.46 MB — about half a byte each**. That is most of the engineering in
this feature, and it is what makes the answer something a job uploads without
thinking about it.

Those timings are the recorder writing the file-level axis; cases add an
attribution per crossing on top of them.

What it costs *you* is not what it cost us. Plan around +10% and treat
anything under that as luck: how many regions a test crosses is a property of
your code, not of the recorder, and a suite that spends most of its time in
one hot module pays differently from one that spends it starting workers.
What those cycles buy, though, is the part worth putting on the other side of
the comparison — and it is not a percentage. A run under `--coverage` ends
with a number. A run under the recorder ends with a dataset that says which
tests have been through which lines, and that is the input to running fewer
of them next time. Measure both halves on your own suite: the overhead the
way those figures were made — five runs with the recorder, five without,
compare the medians — and then a selected run against the full one.

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

Two more distinctions survive the fold only if the axis is there. A case that
was inside a region **only while its module was evaluating** was present rather
than exercising anything, so it is counted apart from one that called in. And a
region **recorded but covered by nobody** is a different statement from a line
in no recorded region at all: the first is a hole, the second is a coordinate
the recording never claimed to cover.

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
decision below depends on someone other than the author being able to ask.

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
from the recorded commit for exactly this reason. At +2% to +8% there is no
budget argument against recording on every run, which is the cadence this
wants.

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

**A crossing is a pair.** One row is *this case covered this region*, and the
index is those pairs and nothing else: three parallel integer columns, sorted
case-major, delta-coded and run-compressed. Sorting case-major is what makes
the run coding pay — a case's crossings arrive together, so the case column is
a handful of runs rather than a million values. The sizes at four scales are in
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

Crossings are whole-test. A region covered during a test's setup and a region
covered by the behaviour under test are both that test's crossings; the
phase-level reading is authored structure, which is [Eyes](eyes.md), and
`variance distill` is where the two are joined.
