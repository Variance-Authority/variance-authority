# Addressing scale

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
record. Most of this page is the arithmetic on both. A third artifact — the
[lexicon](lexicon.md), which is what lets you *find* a subject rather than
decide whether to run one — is priced on a different axis entirely, and
[has its own arithmetic](#the-lexicon-is-priced-in-subjects) at the end.

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
throws away, and its size is the fair question.

You can price the folded version yourself in one command, with nothing to
install: Node writes raw V8 coverage to a directory when you set
`NODE_V8_COVERAGE`.

```bash
NODE_V8_COVERAGE=./coverage-raw yarn test
du -sh ./coverage-raw
```

Run against this repository's own unit suite — 21 test files over 756 modules —
that directory is **37 MB of JSON**, and it is already folded: one file per
worker process, not one per test. Ask for the unfolded relation, one row per
test per region, and the multiplier is the number of test files.

Two fears attach to that once a repository is large: that recording it produces
gigabytes of data, and that reading it needs gigabytes of memory. The figures
below come from two recordings:

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
That is [hash consing](https://en.wikipedia.org/wiki/Hash_consing) over sets,
and the identifier in the region column is
[dictionary encoding](https://en.wikipedia.org/wiki/Dictionary_coder) — the
same pair of tricks behind ClickHouse's `LowCardinality` columns and the
dictionary pages in [Apache Parquet](https://parquet.apache.org). Module paths
and test names are held the same way, as one interned
[string dictionary](https://en.wikipedia.org/wiki/String_interning) per
generation, which is why a name costs bytes once however many rows repeat it.

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
[columnar](execution-record.md#the-coverage-file) —
[column-oriented storage](https://en.wikipedia.org/wiki/Column-oriented_DBMS),
the layout Parquet, [Apache Arrow](https://arrow.apache.org) and ClickHouse all
use, where each field is a contiguous compressed run and a reader decompresses
only the fields the question names. So a question touches the columns it
needs:

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

## What both halves cost, at four sizes

Both files grow with modules and stay linear, so you can price your own
repository before recording anything. The two middle rows are measured; the
outer two are those constants applied to a size nobody here has recorded.

| your repository | modules | source index | execution record |
|---|---|---|---|
| a medium app, ~200k lines | ~2,000 | ~0.7 MB | ~1 MB |
| a large library — Material UI | 24,519 | 7.8 MB | 0.5 MB, over the 791 its Vitest suite enters |
| a large monorepo | 200,000 | 67 MB | 77 MB |
| a very large monorepo | 2,000,000 | ~670 MB | ~770 MB |

The constants behind the outer rows are **0.33 KB per module** of index and
roughly **0.4 KB per module** of record. Material UI's record is the small one
because a record is priced by the modules its suite actually enters, not by the
modules the scan found.

**Those are disk figures, and disk is the axis that grows.** Neither file is
loaded. At two million modules a run still reads the index segment by segment
and the record column by column, so the resident figure stays the one measured
above: about 120 MB for a cold answer to a 100-file diff. What a repository
that size changes is how long a first scan takes and how much storage you keep,
not how much memory a run needs.

## The lexicon is priced in subjects

Selection is priced in modules. Finding a subject is not. The
[lexicon](lexicon.md) is written per subject, so what it costs is decided by
how many subjects your suite has, and not by how large the repository around
them is. Twenty million lines behind two hundred stories is a small lexicon.
Two hundred thousand lines behind twenty thousand stories is a large one, and
that is the case worth pricing.

Two suites, measured:

| | material-ui | a product web app |
|---|---|---|
| subjects | 4,705 | 572 |
| read from | unbundled sources | a production Storybook build |
| values kept | 96,510 | 43,043 |
| values per subject | 20.5 | 75.3 |
| bytes per subject | 243 B | 1,627 B |
| the whole lexicon | 1.09 MB | 0.89 MB |

The per-subject figure is the constant to apply to your own suite, and the two
are further apart than they look. Material UI's run wrote no `files` at all —
the field was read and is genuinely empty — while the product app's `files`
is 58% of its lexicon on its own, because a production build names its modules
`assets/HeatmapTooltip-7CU4gII7.js` and every subject holds a couple of dozen
of them. Set that field aside and the figures are 243 B and 689 B per subject:
a product suite costs about three times a library suite, because product
language is longer than component names.

Applied to twenty thousand subjects, which is the size that prompts the
question:

| | the lexicon on disk | the index in memory |
|---|---|---|
| library-shaped, 243 B per subject | ~5 MB | ~42 MB |
| product-shaped, 1,627 B per subject | ~33 MB | ~229 MB |

Those two rows are the measured constants applied to a size nobody here has
recorded, the way the rows above are. They are also an upper bound rather than
a forecast: the memory figure was taken before file provenance stopped
carrying the dev server's origin, and the disk figure is spending 58% of itself
on content hashes.

### Where things were costs more than what they are called

The [landmarks](lexicon.md) — the arrangement the same walk writes down — are
priced per subject too, and they are the larger half:

| | material-ui | a product web app |
|---|---|---|
| subjects carrying landmarks | 3,827 of 4,705 | 543 of 572 |
| landmarks | 11,599 | 15,057 |
| per subject, median | 1 | 9 |
| per subject, 99th | 12 | 231 |
| per subject, largest | 52 | 1,179 |
| bytes per subject carrying them | 284 B | 2,598 B |

A component library's capture is one control on a blank page, so a subject
holds one landmark and the median says so. A product screen is a screen: a
median of nine, a tail of a few hundred, and one page of eleven hundred. That
is the ratio to carry to your own suite — the number of landmarks is the number
of things a person could point at, and a library has few per subject because it
puts few on a page.

The tail is capped at twelve hundred per subject, which is what the largest
real screen holds. A cap on landmarks costs differently from a cap on values: a
field that loses a value loses a word the subject says elsewhere, and a subject
that loses a landmark loses a place, which has no second spelling. Twenty
thousand product-shaped subjects is about 52 MB of landmarks, against 33 MB for
the rest of the lexicon.

### Why a deep tree does not make it unbounded

A subject in a real application can be six hundred boundaries deep, and the
honest question about a number like 243 B is what stops it becoming 24 KB when
every screen sits under an application's worth of higher-order components,
providers and context consumers.

The cap does. Each field keeps at most two hundred distinct values, so a
subject's entry has a ceiling no tree depth can pass: eight fields at two
hundred values of the median length each is **17 KB** on Material UI's
vocabulary and **27 KB** on the product app's. Twenty thousand subjects all
pinned at that ceiling is a third of a gigabyte — worth knowing, and roughly
forty times what either suite actually spends, because no real subject fills
every field.

What makes the bounded version still worth keeping is [which two hundred it
keeps](lexicon.md#what-a-deep-tree-does-to-it): the values the fewest other
subjects hold, rather than the ones that sort first. A depth-600 tree under
three hundred wrappers would otherwise keep `Anonymous` and `Connect(Account)`
and drop the one component the subject is about.

### The vocabulary saturates; the postings do not

The index a question runs against is a token list and a postings list, and the
two grow differently. Counted over the same suite at increasing numbers of
subjects:

| subjects | distinct tokens | values |
|---|---|---|
| 50 | 149 | 604 |
| 250 | 219 | 5,109 |
| 1,000 | 535 | 27,387 |
| 4,705 | 1,300 | 96,510 |

Ninety-four times the subjects is a hundred and sixty times the values and
under nine times the vocabulary. Words repeat; that is what a vocabulary is.
The product app is more varied and saturates more slowly — eleven times the
subjects for five times the vocabulary — but both bend the same way.

So the list that gets binary-searched for a prefix grows far slower than the
suite, and the lists that get intersected grow with it. Memory is linear in
values. A question costs what its own words touch.

### What a question touches

A term's cost is the length of its postings, which is a share of the corpus
rather than a scan of it:

| a question against | entries it visits | of the corpus |
|---|---|---|
| `checkbox`, on 4,705 subjects | 521 | 0.5% |
| `autocomplete`, on 4,705 subjects | 3,045 | 3.0% |
| `checkbox`, on 572 subjects | 35 | 0.08% |
| a two-word product question, on 572 | 2,759 | 6.3% |

A rare word stays cheap at any size. A word a fifth of your suite holds costs
a fifth of your suite at any size, which is the honest scaling pressure here:
at twenty thousand subjects a saturated word means ranking tens of thousands of
entries, and no amount of index structure makes a word that fails to
distinguish distinguish. That is a ranking problem rather than a storage one,
and [what a starting point is worth](lexicon.md#what-a-starting-point-is-worth)
is the measurement of the lever that moves it.

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
