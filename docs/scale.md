# Addressing scale

You are sizing this for a repository of several hundred thousand files and want
to know whether it fits before you commit to it. Deciding which tests a change
can skip obliges you to keep files on disk; below are what they weigh, what a
question against them costs, and where the answer stops being worth having.

**Three files are priced here, and each is priced against a different count of
your own.** Have these three numbers to hand before you read any table below:

| to price | the count you need |
|---|---|
| the [source index](source-index.md) | the modules in your checkout — the source files `git ls-files` lists |
| the [execution record](execution-record.md) | the modules your suite **enters**, which is a fraction of the first that only a recording knows |
| the [lexicon](lexicon.md) | the **subjects** your suite captures — a subject is one named UI state you asked for and can ask for again |

Nothing on this page converts one of those counts into another, because nothing
in the three relates them. A component library's unit suite enters 3% of the
repository's modules and captures thousands of subjects; an application's suite
enters most of what it ships and captures hundreds. Both ratios are properties
of the suite, so go and count all three.

A tool that reads your whole codebase can run out of memory on a large one.
There is a size past which dying is fair. A decades-old enterprise tree running
to tens of millions of lines is a rock, and nothing here pretends to lift it.

What [test selection](selecting.md) is built for is the shape a large
repository usually has in practice: hundreds of thousands of files, grown
quickly, not all of it written well, with a handful of test files that pull in
half the codebase on their own. That is the case the rest of this page is
worked against, because it is the hard one. If the arithmetic holds there,
your repository is the easy one.

**Every millisecond on this page was taken on one machine:** an Apple M4 Max
(Mac16,9), 16 cores — 12 performance and 4 efficiency — 64 GB of memory, macOS
27.0 on arm64, Node v26.7.0, Yarn 4.18.0. Bytes do not depend on that and
transfer directly, and every byte figure here is decimal: 1 KB is 1,000 bytes
and 1 MB is 1,000,000. The times do, and they are single-machine wall clock taken
with a warm filesystem cache, which makes them a floor rather than a budget —
on shared CI vCPUs, which is the other end of the hardware range, expect
worse.

For the mechanical account underneath the arithmetic — what a record shares
between tests, why the relation factorises, and how one question avoids reading
the whole record — read [how the test-to-code map stays
small](how-selection-scales.md) alongside this page.

## Three files have to fit

Selection starts with a [scan of the source](source.md). [Sense](../packages/sense)
reads every file, resolves what it imports, and writes one record per file
into the [source index](source-index.md). That index answers what a change
*could* reach, and a run consults it before it runs anything.

The [execution record](execution-record.md) then narrows that to what each
test *actually* entered: for every test file, the
[regions](execution-record.md#blocks) of every module it went through while it
ran. A **region** is one piece of a module's text the instrument cut — a
function body, a branch arm, the module's top level — and one test entering one
region is a **crossing**. The record is the whole set of crossings your suite
produced, written to one binary file.

The [lexicon](lexicon.md) answers a different question: not whether to run a
subject, but how to *find* one. It is written per subject, which
puts it on its own axis — the index and the record are priced in modules, and
the lexicon is priced in subjects.

This page is the arithmetic on all three, in that order. A fourth file is
optional and priced at the end: turning on [`cases`](execution-record.md) asks
the same relation at case granularity instead of file granularity, and it is
the only one of the four that grows on two axes at once.

## The source index

Every `variance run --since <ref>` begins by reading the tree, the way
`git status` does before it prints anything: it asks git which files changed,
parses those, resolves their imports, and updates the index. That reading is
the scan. It is a parse and a resolver, and nothing in it builds or executes
your code.

Measured on [Material UI](https://github.com/mui/material-ui), 41,165 tracked
paths of which 24,519 are modules, the first scan is under three seconds and
produces an 8.0 MB index. Every run after it reuses that index, so the figure
that matters is what a run pays before it selects anything, after an edit:

| since the last run, the tree is | a run waits |
|---|---|
| new, no index at all | 2,866 ms |
| unchanged | 357 ms |
| four files edited | 332 ms |
| five hundred files edited | 460 ms |

An edit costs the records it touched and a fixed toll on top, which is why the
last three rows sit together. Where those numbers come from, and what a file
appearing or moving costs, is in [what a source scan costs](performance.md).

**The cold scan is about 0.12 ms per module** — 2,866 ms over 24,519. Scaled up
linearly that is **roughly 24 seconds at 200,000 modules and about four
minutes at 2,000,000**, once per machine and never again. Read both as linear
extrapolation from the one measured scan, not as measurements: the scan reads,
parses and resolves each module, and resolution is priced per specifier, so a
repository averaging more imports per file costs more than that line predicts.
The 330 ms a warm run pays underneath the diff is charged against the whole
tree as well, and it grows on the same axis.

Size scales with files, and it stays linear. A synthetic 200,000-file shape,
written and read back through the index's own code, measures **67.3 MB** as
shared binary sections against 598 MB for the same records as JSON, because
every name is interned once across the generation. That is a measurement of the
format at that size, on generated paths rather than on a real tree.

**Three counts of Material UI appear on this page and they are not the same
count.** 41,165 is every path git tracks in the checkout. 24,519 is the module
files among them, and it is what the timings above are charged per. 25,117 is
the records the index wrote, because the walk also records the stylesheets and
declaration files the module listing excludes, and it is what the byte rates
below are charged per.

Real trees give the rate to work from, and it is a range rather than one number:
**318 B per file** over Material UI's 25,117 records, **411 B** over
[Docusaurus](https://github.com/facebook/docusaurus)'s 2,670, and **556 B** over
a 1,236-file TypeScript workspace. Bytes per file track how many edges a file
has, not how large the repository is, which is why the largest of the three is
the cheapest per file. A real 200,000-file tree lands somewhere between about
60 MB and 110 MB.

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
cannot say that about any test. So the execution record saves what coverage
throws away, and its size is the fair question.

You can price the folded version yourself in one command, with nothing to
install: Node writes raw V8 coverage to a directory when you set
`NODE_V8_COVERAGE`.

```bash
NODE_V8_COVERAGE=./coverage-raw yarn test
du -sh ./coverage-raw
```

Run against a 21-file unit suite over 756 modules, that directory is **37 MB of
JSON**, and it is already folded: one file per worker process, not one per
test. Ask for the unfolded relation, one row per
test per region, and the multiplier is the number of test files.

Two fears attach to that once a repository is large: that recording it produces
gigabytes of data, and that reading it needs gigabytes of memory. A third is
about the clock rather than the bytes — that a suite under instrumentation
crawls — and it is answered where the suites are timed, in
[what recording costs while the suite runs](selecting.md#what-recording-costs-while-the-suite-runs):
1.02× on Zod and 1.08× on TanStack Query, against 1.30× for the same suites
under `--coverage`. The figures below come from two recordings:

- **Material UI.** [Material UI](https://github.com/mui/material-ui)'s own
  Vitest suite, recorded with the selection probes installed: 791 modules, 184
  test files and 8,143 regions entered. It is public, large enough to break
  things, and impossible to tune for.
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
repository runs to hundreds of millions. Expanded into pairs, one per test per
region, that is gigabytes before a byte is written to disk.

The record never stores pairs. A region does not own the list of tests that
entered it. It names one entry in a pool of the **distinct** sets of
tests, and the pool keeps one copy of each set, however many regions name it.
That is [hash consing](https://en.wikipedia.org/wiki/Hash_consing) over sets,
and the identifier in the region column is
[dictionary encoding](https://en.wikipedia.org/wiki/Dictionary_coder) — the
same pair of tricks behind ClickHouse's `LowCardinality` columns and the
dictionary pages in [Apache Parquet](https://parquet.apache.org). Module paths
and test names are kept the same way, as one interned
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
inside 132 MB. The same relation written as bare integer pairs has a floor of
2,561 MB, and as pointers 5,123 MB. The three orders of magnitude are not
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

### Which memory figure answers which question

| you want to know | the figure |
|---|---|
| what a run needs in memory while it answers a diff | **about 120 MB resident**, cold, against the 200,000-module record |
| what the record costs on disk | 77 MB at 200,000 modules; 0.5 MB on Material UI |
| what the most expensive question in the format peaks at | 322 MB, every module against every test |
| what building the crossing relation costs | 132 MB, for 671 million crossings folded to 3,408 distinct sets |
| what it would cost if no sharing existed at all | a 510 MB peak over 386 MB of containers |

**Plan against the first row.** It is the only one an ordinary run pays. The
rest are ceilings: two you pay only by asking for them, and one that no real
import graph can produce.

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
across machines produces one record per shard.
[`variance journeys`](../packages/cli#sharding-journeys-takes-more-than-one-file-too)
is the command that reads execution journals — which regions of which modules
each test entered on its way through — and folding shards is one of its modes,
because a fold is several journals read as one. It produces the union the
unsharded run would have written:

```bash
variance journeys shard-1/coverage.bin shard-2/coverage.bin --into coverage.bin
```

The fold refuses rather than guesses. Shards recorded at different commits, or
under different **probe recipes** — the instrumentation configuration a build
applied, which is what the ordinals in a journal are numbered against — are
named and rejected. Two shards share a recipe when they run the same
instrumented build of the same commit, which is what one checkout and one
configuration give you. A test file two shards both recorded means the split
overlapped, which only you can resolve. And where
the shards disagree about whether a module was readable, **unknown wins**,
because the row a reader widens on must not be outvoted by the shards that
happened to measure it. The stitched record is the one you share.

**A shared record is supported and never required.** Locally you can record one
and use it, fetch the one CI stitched and layer today's run on top, or work from
nothing at all. A missing or stale record costs a slower answer, never a
different one. The scan caches are content-addressed and behave the same way.

## What the index and the record cost, at four sizes

Both files grow with modules and stay linear. The index column you can price
before recording anything, from a count git already gives you; the record
column is priced per module your suite enters, which only a recording tells
you. Material UI's row is measured on a real repository. The 200,000 row is measured, at that size, on fixtures rather than
on a real tree. The outer two rows are **extrapolation** — those figures
extended linearly to a size no one has measured.

| your repository | modules | modules its suite enters | source index | execution record |
|---|---|---|---|---|
| a medium app, ~200k lines | ~2,000 | ~1,400 | ~0.7 MB | ~1 MB |
| a large library — Material UI | 24,519 | 791 | 8.0 MB | 0.5 MB |
| a large monorepo | 200,000 | 200,000 | 60–110 MB | 77 MB, a floor |
| a very large monorepo | 2,000,000 | 2,000,000 | ~600 MB – 1.1 GB | ~770 MB, a floor |

The index column is a range, not a point, because the rate is: across the three
real projects above it runs 318 B to 556 B per file, and what sets it is edges
per file. Multiplied out to 200,000 files that is 60 MB to 110 MB, and to
2,000,000 it is ten times that. The 67.3 MB the synthetic shape measured sits
inside the range, near its floor.

**The two module columns are different counts, and the gap between them is
yours to measure.** Material UI's Vitest suite is a unit suite over a component
library: it enters 791 of 24,519 modules, about 3%, because most of what the
repository tracks is documentation, examples and packages that suite never
imports. An application's own suite enters most of the application, which is why
the medium-app row assumes roughly 1,400 of 2,000. The 200,000 fixture enters
every module it contains, because it was built that way. What sets the rate is
how much of the tree your test files import, and only a recording tells you.

**The record needs a different constant from the one a per-module figure
gives.** The fixture's 77 MB over 200,000 modules is 0.385 KB per module, and
applying that to Material UI's 791 entered modules predicts 0.32 MB against a
real 0.5 MB — so the per-module figure is the wrong shape for this file. A
record is priced by the regions a suite entered, the test files that entered
them, and one interned string dictionary of paths, region names and digests.
Material UI enters 8,143 regions with 184 test files, which is a far denser
test axis than the fixture's 2,000 files over 200,000 modules, and its names
are real paths rather than generated ones.

Measured on the two real recordings there are, a record costs roughly **0.65 to
0.77 KB per entered module**: 0.5 MB over Material UI's 791, and 0.7 MB over a
429-file suite's 977. Use that range. The 0.385 the fixture gives is a floor,
which is why the last two rows of the table are marked as floors: they are
priced per module of the fixture, on generated names, against a test axis far
sparser than a real suite's. Material UI's record is the small
one in the table for a separate reason: a record is priced by the modules its
suite actually enters, not by the modules the scan found.

**Those are disk figures, and disk is the axis that grows.** Neither file is
loaded. At two million modules a run still reads the index segment by segment
and the record column by column, so the resident figure stays the one measured
above: about 120 MB for a cold answer to a 100-file diff. What a repository
that size changes is how long a first scan takes — priced per module above —
and how much storage you keep, not how much memory a run needs.

## The per-case index, when you ask for it

Everything above prices the relation at file granularity: which *test file*
entered which region. That is what a skip list needs, and it is the only thing
a `--since` run reads. Turn on `cases` and a second file is written beside the
record holding the same relation at case granularity — which *case* entered
which region — because that is what answers *which tests walk this branch* and
what [`variance covering`](../packages/cli#covering-which-tests-entered-this-line) and
[`distill`](distill.md) read.

Its test axis is cases rather than test files, and nothing folds them, so it
is larger than the record it sits beside and the gap widens as a suite grows
cases faster than it grows files. Three real recordings:

| cases | crossings | record | per-case index |
|---|---|---|---|
| 4,494 | 906,578 | 0.3 MB | 0.46 MB |
| 2,779 | 751,667 | 0.5 MB | 0.46 MB |
| 659 | 89,277 | 0.7 MB | 0.21 MB |

Half a megabyte for nine hundred thousand crossings is **about half a byte per
crossing**, and it gets there the same way the record does: a crossing is not
an object with field names, it is a position in three parallel integer columns,
and the columns are run-coded. A case axis sorted by the case that produced it
leaves the test column as long ascending runs, and the distance column of a
recording made by these probes is a single run of zeroes.

Ask for the same index as JSON — name your `executionFile` with a `.json`
suffix and you get it, for a reader that has to have it — and the first row
above is **27.2 MB** instead of 0.46. That is the cost of spelling every
crossing as `{"test":0,"distance":0}`: thirty-odd bytes for a pair of small
integers, ninety times the file it sits next to. Take the JSON only when
something downstream cannot be taught to read the other one.

## Every CI caps what a job may upload

Artifact and cache limits are not a detail to discover on the run that exceeds
them. Every hosted runner has a cap, most of them are configurable and none of
them are large, and a record that does not fit is a record CI cannot hand to
the next job — at which point selection has nothing to narrow against and
every run is a full run.

So price the upload, not the disk. What travels between jobs is the record and,
if you ask for it, the per-case index; the source index is rebuilt from the
tree and the lexicon travels with whatever consumes it.

| what you upload | 791 entered modules | 200,000 modules |
|---|---|---|
| execution record | 0.5 MB | 77 MB |

The per-case index is not in that table because no module count predicts it.
Its multiplier is your case count, which is a number only your suite has.
Price it from a recording instead: it is roughly half a byte per crossing, and
your crossing count is cases times the regions each one enters. A suite of
20,000 cases entering 500 regions each is ten million crossings, which is
about 5 MB. Measured, the three recordings above run 0.21 MB to 0.46 MB.

Two things to do if your cap is the binding constraint. Compress the upload —
the columns are run-coded but the file as a whole is not, and gzip takes a
0.46 MB per-case index to 0.31 MB. And leave `cases` off
until something asks a question that needs it: the skip list never reads that
file, so a run that does not record it selects exactly as well.

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
recording answers it, and three commands get you there. Run your suite once
with the Vitest or Jest integration installed — that run writes the record —
then check out a recent pull request and ask
[`variance select`](../packages/cli#select-what-your-own-runner-may-skip) what
it would have skipped:

```bash
npx vitest run
git switch <a recent pull-request branch>
npx variance select --format json
```

The counts it reports are the skip list that diff would have had.

## The lexicon is priced in subjects

Selection is priced in modules. Finding a subject is not. The
[lexicon](lexicon.md) is written per subject, so what it costs is decided by
how many subjects your suite has, and not by how large the repository around
them is. Twenty million lines behind two hundred stories is a small lexicon.
Two hundred thousand lines behind twenty thousand stories is a large one, and
that is the case worth pricing.

Two suites, measured. The second is a product application rather than a
library: 572 subjects read from a production Storybook build, in a browser with
layout resolved, its component names minified by that build. It is not public,
so unlike Material UI you cannot check it. It is here because it is
product-shaped where the other is library-shaped, and that is the axis the
table is about.

| | material-ui | a product web app |
|---|---|---|
| subjects | 4,705 | 572 |
| read from | unbundled sources | a production Storybook build |
| values kept | 96,510 | 43,043 |
| values per subject | 20.5 | 75.3 |
| bytes per subject | 243 B | 1,627 B |
| all of the terms, together | 1.14 MB | 0.93 MB |

That last row is the terms and nothing else, and it is the per-subject figure
above it multiplied out. Landmarks are priced further down and are the larger
half on a product suite: 284 B per subject against 243 B of terms on Material
UI, and 2,598 B against 1,627 B on the product app. Budget from the sum rather
than from this table alone.

The per-subject figure is the constant to apply to your own suite, and the two
are further apart than they look. Material UI's run wrote no `files` at all,
while the product app's `files` is 58% of its lexicon on its own, because a production build names its modules
`assets/Component-a1b2c3.js` and every subject lists a couple of dozen
of them. Set that field aside and the figures are 243 B and 689 B per subject:
a product suite costs about three times a library suite, because product
language is longer than component names.

**Subjects are the wrong axis for part of this.** Counted per boundary — every
attributed component instance the same walk passes through — the lexicon runs
**38 B to 51 B** across the suites measured, and what decides where a suite
lands in that range is how large its subjects are. Material UI sits at the
bottom of it, 38 B over 4,705 subjects and 65,132 boundaries, because a library
subject is one control on a blank page. A suite of few, large subjects — where
one subject is a whole page and the page is a tree — sits at the top. So a
per-subject figure transfers only between suites whose subjects are about the
same size, and the per-boundary range is what travels across that difference.

Applied to twenty thousand subjects, which is the size that prompts the
question:

| | the lexicon on disk | the index in memory |
|---|---|---|
| library-shaped, 243 B per subject | ~5 MB | ~42 MB |
| product-shaped, 1,627 B per subject | ~33 MB | ~229 MB |

Those two rows are the measured constants applied to a size no one has
measured, the way the rows above are. Both are an upper bound rather than a
forecast, and in a direction you can name: the disk figure spends 58% of itself
on content hashes.

### Where things were costs more than what they are called

The [landmarks](lexicon.md) — one entry per node that bears a role, an
accessible name or words of its own, each with what it says, where it sat and
what encloses it, which is how the same walk writes down the arrangement —
are priced per subject too, and on a product suite they are the larger half:
2,598 B per subject against the terms' 1,627 B, which is 1.6 times. On a
library suite the two are close, 284 B against 243 B.

| | material-ui | a product web app |
|---|---|---|
| subjects with landmarks | 3,827 of 4,705 | 543 of 572 |
| landmarks | 11,599 | 15,057 |
| per subject, median | 1 | 9 |
| per subject, 99th | 12 | 231 |
| per subject, largest | 52 | 1,179 |
| bytes per subject that has them | 284 B | 2,598 B |
| all of the landmarks, together | 1.09 MB | 1.41 MB |

A component library's capture is one control on a blank page, so a subject
shows one landmark and the median says so. A product screen is a screen: a
median of nine, a tail of a few hundred, and one page of eleven hundred. That
is the ratio to expect in your own suite — the number of landmarks is the number
of things a person could point at, and a library has few per subject because it
puts few on a page.

So the artifact comes to at least the two totals added: 2.2 MB for Material UI,
2.3 MB for the product app. A third part sits beside them, `declaredIn`, which
joins each component to the files declaring it. It is written once for the
whole run rather than once per subject, so it grows with the number of
components in your repository and not with the number of subjects you capture,
and it is absent entirely from a run that read no source index. Three parts,
three different things they scale with: terms per subject, landmarks per
subject that has them, `declaredIn` per component in the checkout.

The tail is capped at twelve hundred per subject, which is what the largest
real screen shows. A cap on landmarks costs differently from a cap on values: a
field that loses a value loses a word the subject says elsewhere, and a subject
that loses a landmark loses a place, which has no second spelling. Twenty
thousand product-shaped subjects is about 52 MB of landmarks, against 33 MB for
the rest of the lexicon.

### Why a deep tree does not make it unbounded

A subject in a real application can be six hundred boundaries deep, and the
honest question about a number like 243 B is what stops it becoming 24 KB when
every screen sits under an application's worth of higher-order components,
providers and context consumers.

The cap does. A **field** is one bag of values the run writes down per
subject — the accessible names on it, its visible text, the components it
mounted, the regions it entered, the files those came from, the design tokens
it resolved through — and each field keeps at most two hundred distinct values,
so a subject's entry has a ceiling no tree depth can pass: eight fields at two
hundred values of the median length each is **17 KB** on Material UI's
vocabulary and **27 KB** on the product app's. Twenty thousand subjects all
pinned at that ceiling is about **340 MB** on the library vocabulary and about
**540 MB** on the product one — worth knowing, and 70 times what a library
subject actually spends and 17 times what a product subject does, because no
real subject fills every field.

What makes the bounded version still worth keeping is [which two hundred it
keeps](lexicon.md#what-a-deep-tree-does-to-it): the values the fewest other
subjects share, rather than the ones that sort first. A depth-600 tree under
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

A rare word stays cheap at any size. A word that appears in a fifth of your
suite costs a fifth of your suite at any size, which is the honest scaling
pressure here: at twenty thousand subjects a saturated word means ranking tens
of thousands of entries, and no amount of index structure makes a word that
fails to distinguish distinguish. That is a ranking problem rather than a
storage one, and
[what a starting point is worth](lexicon.md#what-a-starting-point-is-worth)
is the measurement of what changes it.

## What these numbers are, and are not

**The diffs measured above are all modules the record has seen.** A real pull
request contains a config, a generated file, a module added since the recording,
and a changed path the record cannot answer for retires the skip list for the
**whole run**, not just for that file. That is the safe behaviour, and it is why
these figures are the cost of an answer rather than a promise of how often you
get one. Which changes widen a run is in [running less of the
suite](selecting.md#where-selection-widens).

**These are the cost of keeping the record and reading it.** What a full suite
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
  install and container start, skipping most of the test files saves very
  little.
- **A tree that never gets recorded over.** Line ranges are coordinates in the
  text the suite ran over, and a module whose text has changed since is
  charged whole.
