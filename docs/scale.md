# Whether test selection fits your repository

Most tools that reason about a whole codebase were never built for a large one,
and the way you find that out is that they die on yours.

There is a size past which dying is fair. A decades-old enterprise tree running
to tens of millions of lines is a rock, and nothing here pretends to lift it.

What [test selection](selecting.md) is built for is the shape a large
repository usually has in practice: hundreds of thousands of files, grown
quickly, not all of it written well, with a handful of test files that pull in
half the codebase on their own. That is the case the rest of this page is
worked against, because it is the hard one. If the arithmetic holds there,
your repository is the easy one.

## Two things have to fit

Selection starts with a [scan of the source](source.md). [Sense](../packages/sense)
reads every file, resolves what it imports, and writes one record per file
into the [source index](source-index.md). That index answers what a change
*could* reach, and a run consults it before it runs anything.

The [execution record](execution-record.md) then narrows that to what each
test *actually* entered: for every test file, the
[regions](execution-record.md#blocks) of every module it went through while it
ran. One test entering one region is a **crossing**, and the record is the
whole set of crossings your suite produced, written to one binary file.

So two things have to fit your repository, in that order: the index, and the
record. The rest of this page is the arithmetic on both.

## The source index

Every `variance run --since <ref>` begins by reading the tree, the way
`git status` does before it prints anything: it asks git which files changed,
parses those, resolves their imports, and updates the index. That reading is
the scan. It is a parse and a resolver, and nothing in it builds or executes
your code.

Measured on [Material UI](https://github.com/mui/material-ui), 41,165 tracked
paths of which 24,519 are modules, the first scan is under three seconds and
produces a 7.8 MB index. Every run after it reuses that index, so the figure
that matters is what a run pays before it selects anything, after an edit:

| since the last run, the tree is | a run waits |
|---|---|
| new, no index at all | 2,866 ms |
| unchanged | 357 ms |
| four files edited | 332 ms |
| five hundred files edited | 460 ms |

An edit costs the records it touched and a fixed toll on top, which is why the
last three rows sit together. Where those numbers come from, and what a file
appearing or moving costs, is in [what a run costs](performance.md).

Size scales with files, and it stays linear. The index of a 200,000-file
repository is **67 MB** as shared binary sections, against 598 MB for the same
records as JSON, because every name is interned once across the generation.
That is the whole index on disk. A run does not load it either: the index is
read segment by segment, newest first, and a record whose bytes and
surroundings have not changed is never parsed again.

## The execution record

You already have something like it: code coverage. Istanbul, c8 and V8's own
coverage record which lines ran while the suite ran. What they hand you is a
count per line, folded across every test, so the report can say *this line was
covered* and never *by which test*. The folding is what keeps a coverage report
small. The unfolded relation is tests multiplied by lines, and a coverage tool
never stores it, because for a large suite it is gigabytes.

Selection needs the unfolded relation. Skipping a test on a changed line is
only safe if the record says that test never entered it, and a count per line
cannot say that about any test. So the execution record holds what coverage
throws away, and its size is the fair question. Two fears attach to it once a
repository is large: that recording it produces gigabytes of data, and that
reading it needs gigabytes of memory. The figures below come from two
recordings:

- **Material UI.** [Material UI](https://github.com/mui/material-ui)'s own
  Vitest suite, recorded with the instrument installed: 791 modules and 184
  test files. It is public, large enough to break things, and impossible to
  tune for.
- **A 200,000-module fixture.** That recording scaled 253 times, to 200,000
  modules and 2,000 test files. Its module paths, its region counts per module
  and its region spans are drawn from the real recording, and the two region
  distributions are under half a percent apart. One axis is synthesized, and
  it is the one that decides how *well* selection works: which test entered
  which module. So the large fixture answers how long, how many bytes and how
  much memory, and it is never allowed to answer how many tests you skip.
  Every share-of-the-suite figure below comes from Material UI.

### Why it is megabytes and not gigabytes

Multiply modules by regions by test files and the crossing count of a large
repository runs to hundreds of millions. Held as pairs, one per test per
region, that is gigabytes before a byte reaches disk.

The record never holds pairs. A region does not own the list of tests that
entered it. It holds an identifier into a pool of the **distinct** sets of
tests, and the pool keeps one copy of each set, however many regions name it.

Sharing on that scale is what imports produce, not a compression trick. A test
file reaches tens of thousands of modules by importing barrels, and every leaf
under a barrel is entered by exactly the tests that touched the barrel. So the
audience belongs to the barrel, and every leaf under it points at one set. A
set entered by the whole suite, the row a pair store charges most for, costs
five bytes.

On a barrel-shaped repository of 200,000 modules and 2,000 test files, **671
million crossings collapse to 3,408 distinct sets**, built, stored and queried
inside 132 MB. The same relation held as bare integer pairs has a floor of
2,561 MB, and held as pointers 5,123 MB. The three orders of magnitude are not
in the encoding. They are in not writing the same fact once per leaf.

Now assume none of that sharing exists. Give every one of the fixture's 1.6
million regions its own set, sharing nothing with anything, and the record is
386 MB of containers at a 510 MB peak. Still one process, still no shards, and
still under the memory a test runner is already using. Real imports cannot
produce that shape, which is why it is the ceiling to quote: it does not depend
on your repository being shaped nicely.

### Why reading it does not cost a gigabyte

Nothing loads it. The file is
[columnar](execution-record.md#the-coverage-file), and a question touches the
columns it needs:

| | 200,000 modules, a 77 MB file | Material UI, a 0.5 MB file |
|---|---|---|
| opening it | 43 KB read | 1.8 KB read |
| answering a 100-file diff | 3.7 MB in 498 reads | 0.26 MB in 23 reads |
| as a share of the file | **under 5%** | 53% |

**The share falls as your repository grows.** A small file is mostly header and
dictionary, so a question reads half of it. A large one is mostly rows about
modules your diff did not touch, and those are never decompressed. Cold, in a
new process that opens the file and answers the diff, the whole command is
under a tenth of a second and about 120 MB resident. The second question inside
the same process costs a tenth of the first, because the column runs it
decompressed stay decompressed.

The most expensive question in the format is one no ordinary run asks: every
module against every test, which is how you find out which of your files are
**hubs**, the files most of the repository imports. At 200,000 modules that is
four seconds and 322 MB. It is the ceiling, and one you can afford to hit
deliberately.

### Where the observation comes from

Recording is not one process watching everything. Each test file writes its own
small journal as it finishes, and what happens next depends on whether the suite
was split.

**Locally there are workers and nothing else.** One runner process, however many
workers it spawns, one record at the end: the workers write journals into the
run directory and the reporter reads them and writes the file. There is no
fan-in protocol to operate, no shard ids to keep straight, and no server in the
path.

**In CI there are shards, and they are stitched afterwards.** A suite split
across machines produces one record per shard, and
[`variance journeys`](../packages/cli#sharding-journeys-takes-more-than-one-file-too)
folds them into the union the unsharded run would have written:

```bash
variance journeys shard-1/coverage.bin shard-2/coverage.bin --into coverage.bin
```

The fold refuses rather than guesses. Shards recorded under different probe
recipes or at different commits are named and rejected. A test file two shards
both recorded means the split overlapped, which only you can resolve. And where
the shards disagree about whether a module was readable, **unknown wins**,
because the row a reader widens on must not be outvoted by the shards that
happened to measure it. The stitched record is the one you share.

**A shared record is supported and never required.** Locally you can record one
and use it, fetch the one CI stitched and layer today's run on top, or work from
nothing at all. A missing or stale record costs a slower answer, never a
different one. The same holds for the scan caches, which are content-addressed
for the same reason: nothing in the path is allowed to turn an absent cache into
a wrong answer.

## What decides the value is what changed, not how much

The instinct is that cost tracks how many files changed. It tracks where they
are, far better. Five changed files in Material UI's recorded suite, counted
twice:

| a diff of five files | tests run |
|---|---|
| adjacent, one feature in one subtree | 31 of 184 |
| scattered across the repository | 155 of 184 |

Adjacent files share most of their audience, so the fifth costs little more than
the first. A dependency bump, a codemod or a formatting sweep is the other row,
and there is no honest way to make it cheap: the tests really did enter all of
that.

Adjacency is not a guarantee, and the same recording says so: widen the
clustered diff to ten files and the run jumps to 150 of 184, because the subtree
has grown to include a file most of the library imports. Walk every file in the
suite and ask what it would cost if only that file changed:

- the median file costs **7%** of the suite;
- the ninetieth percentile costs **84%**;
- **a third of the files each cost half the suite or more**, because a utility
  most of the library imports is entered by a test that renders almost
  anything, and a change to it genuinely could break almost anything.

One subtree shows the shape. Eleven adjacent files cost 17% of the suite between
them. The twelfth, a class-names module, costs 78% on its own, and once it is in
the diff the other eleven are free.

So the question worth asking before adopting this is not *how big is my
repository*. It is **how often do my pull requests touch a hub**, and your own
recording answers it. Record your suite once, check out a recent pull request,
and run
[`variance select --format json`](../packages/cli#select-what-your-own-runner-may-skip):
the counts it reports are the skip list that diff would have had.

## What these numbers are, and are not

**The benchmark's diffs are all modules the record has seen.** A real pull
request contains a config, a generated file, a module added since the recording,
and a changed path the record cannot answer for retires the skip list for the
**whole run**, not just for that file. That is the safe behaviour, and it is why
these figures are the cost of an answer rather than a promise of how often you
get one. Which changes widen a run is in [running less of the
suite](selecting.md#where-selection-widens).

**These are the cost of holding the record and reading it.** What a full suite
costs to record is a separate measurement on a separate path, and this page does
not report it.

**Cost is not safety.** Everything here is bytes, milliseconds and resident
memory. Whether a skip list is *right* is a different measurement with a
different instrument, and the figure that settles it is how often a skipped test
would have failed.

## Where this stops paying

- **A repository where most files are hubs.** If your median file costs half the
  suite, this returns a smaller number and not a smaller bill. That is one
  recording to find out.
- **Diffs that are not clustered.** A codemod across four hundred directories
  runs the suite, correctly, and that is not an improvement over running the
  suite.
- **A suite whose cost is not in the tests.** If the wall clock is build,
  install and container start, skipping most of the test files moves very
  little.
- **A tree that never gets recorded over.** Line ranges are coordinates in the
  text the suite ran over, and a module whose text has moved since is charged
  whole.
