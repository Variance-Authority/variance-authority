# How the test-to-code map stays small

[Test selection](selecting.md) needs an answer ordinary coverage deliberately
forgets: **which tests entered the code that changed?** Keeping that answer for
a large repository sounds like keeping every test beside every line it touched.
That representation would be enormous.

Variance Authority keeps the relationship, but not as repeated test-and-code
pairs. It notices that large parts of a repository are reached by the same
audience of tests, stores that audience once, and lets every matching execution
region point to it. The rest of the storage design follows from that choice.

This is why the system resembles ClickHouse without containing ClickHouse. Both
arrange repeated values into dictionaries and columns, then read only the small
part a question needs. Here the question is narrower, and so is the database.

## The relation selection needs

During a run, [execution recording](execution-record.md) divides each module
into regions: the module itself, function bodies, branches, loop bodies,
continuations and handlers. A test records whether it entered a region. It does
not retain how many times the region ran, because selection needs presence, not
frequency.

Conceptually, that produces a relation like this:

```text
cart.test.ts      → Cart/module
cart.test.ts      → Cart/render
cart.test.ts      → Cart/applyDiscount
checkout.test.ts  → Cart/module
checkout.test.ts  → Cart/render
```

This is the useful truth: it lets a changed line lead to the tests that
previously exercised the region containing it. It is also the expensive truth
if every arrow becomes a stored pair.

## The same audience appears many times

Imports give the relation more structure than a table of unrelated pairs
suggests. A test enters a barrel, and through that barrel it enters a large
family of modules. Many regions below that point are therefore reached by
exactly the same tests.

```text
region A  → {cart, checkout, promotion}
region B  → {cart, checkout, promotion}
region C  → {cart, checkout, promotion}
region D  → {cart, checkout, promotion}
```

The audience is the repeated fact. Variance Authority gives that set one
identity and stores this instead:

```text
set 17 = {cart, checkout, promotion}

region A  → set 17
region B  → set 17
region C  → set 17
region D  → set 17
```

The repeated relation is not compressed four times. It is represented once.
This factorisation is the main reason the record stays small; varints and
general-purpose compression improve the result after the larger duplication is
already gone.

In the measured 200,000-module shape, 671 million logical test-to-region
crossings resolve to 3,408 distinct test sets. That ratio is not a promise that
every repository shares equally well. It shows why ordinary import structure
creates a much smaller physical relation than the logical crossing count.

## Why the ClickHouse comparison fits

The [execution record](execution-record.md#the-coverage-file) is a small,
purpose-built columnar store. Modules, regions, test sets and test identities
live in separate columns rather than in a JavaScript object graph with a test
array hanging from every region.

```text
Modules
  └─ Regions
       └─ set id ──────────┐
                           ▼
                    distinct TestSets
                           └─ TestIds
```

Large columns are split into independently compressed runs. A lookup can open
the header, locate one module, read the region rows for the changed lines,
follow their set identifiers, and decode only the corresponding test sets. It
does not need to load the file or construct objects for unrelated modules.

That is the useful ClickHouse analogy:

- repeated values become dictionary identities;
- fields are stored by column rather than by object;
- columns are divided into independently readable runs; and
- a query reads only the columns and runs that can answer it.

Variance Authority is not using ClickHouse as a service or dependency. It is
using the same storage instincts for one local question whose complete schema
is known in advance.

## A module keeps the number it was given

Every column above stores modules as numbers, not paths. The numbers come from
one table the repository keeps beside the record, and the property that table
exists to hold is this: **adding a file never changes the number of a file that
already has one.** Add a module in the middle of a directory, rename a sibling,
grow the repository by a thousand paths — nothing already numbered moves.

That does not fall out of a sorted table by itself. Paths are stored in sorted
order, so a lookup can binary-search them and so neighbouring paths share a
prefix worth front-coding away; sorting is what makes the table small. If the
number were the position in that order, every insertion would shift every path
after it, and an earlier run's record would describe modules by numbers that
now mean different files.

The number is therefore a column beside the sorted paths rather than the
position of one:

```text
sorted order          id column
  src/cart.ts            41
  src/cart/total.ts     903   ← added later, appended
  src/checkout.ts        42
```

A new path takes the next unused number and is written into its own sorted
place. Both facts hold at once because they are held in different places.

Only one direction is asked of the table. A build has a path and needs the
number to emit, which is the binary search above. Going back — number to path —
does not go through the table at all: the module record a build writes as it
instruments a module carries the path and the number together, so whatever reads
that record already holds both. The one caller that does walk numbers back
through the table is compaction, and it visits every entry anyway, so it decodes
the sorted run forwards once rather than carrying a number-to-offset column that
would cost bytes at every entry to save nothing.

The failure this prevents is not a crash. The coverage file is a set of
crossings between test identities and module numbers, and nothing in it restates
a path. If a number silently changed hands, it would still load, still answer,
and answer about the wrong module — selecting the tests that entered `cart.ts`
for a change in `checkout.ts`, and skipping the ones that matter. A stable
number is what makes evidence from an earlier run usable by a later one.

Growth keeps the property. The table is a chain of immutable segments under one
manifest: an append is a new segment holding only the paths that are new, and
compaction merges the chain into one sorted run without disturbing a single
number. Reads are reads of immutable files, so builds transforming ten modules
in parallel need nothing from each other; only the fold that adds new paths
writes, and it writes under an exclusive lock.

Two boundaries are worth knowing:

- **A number is not derived from the path.** It is assigned, because a
  path-derived identity — a digest, however narrow — spends its full width at
  each of the millions of crossings, while assigned numbers form a sorted run
  of small gaps that compresses. Nothing recovers a number from a path except
  the table.
- **A number is meaningful only within one table's lineage.** Two caches grown
  independently on two machines number the same repository differently and have
  no way to agree, so a record travels with the table it was numbered against.
  Within one lineage the number is permanent for as long as the file exists.

A module the table has never seen — a file created since the last run — is
instrumented under its path instead, because a transform cannot wait for an
authority to hand it a number. The run is correct with one module costing
path-length bytes at its crossings, and the next fold numbers it for good.

## One edit becomes one narrow read

When a function changes, selection follows a short path through that structure:

```text
changed lines
    ↓
module and execution region
    ↓
set id
    ↓
tests that entered the region
```

Region boundaries matter here. An edit wholly inside a handler can select the
tests that entered that handler instead of every test that rendered the
containing component. An edit on a line shared with the enclosing function
correctly reaches the wider audience. The
[execution-record reference](execution-record.md#from-a-crossing-back-to-a-line)
defines how changed lines are charged at those boundaries.

The measured 200,000-module record occupies 77 MB. Answering a 100-file diff
reads about 3.7 MB of it. As the repository grows, most additional rows describe
modules outside any one diff, so a focused question touches a smaller share of
the file rather than requiring a larger in-memory graph.

## The source index keeps the answer honest

Runtime evidence describes the source the tests actually ran. It cannot, by
itself, know that today's edit introduced a new import path or moved a
relationship the previous run never observed.

The [source index](source.md) supplies that other half:

```text
source index       what could this change reach?
execution record   what did each test actually enter?
                         ↓
                    selection
```

The source side follows dependency possibility. The execution side supplies the
smaller observed audience. When the source scan or the record cannot support a
narrow answer, selection widens and says why. Missing evidence costs more work;
it does not become permission to skip an unobserved test.

The source index uses a related storage shape—interned strings, columnar
sections and immutable segments—but for a different reason. It makes repeated
scans cheap and safely invalidates records when source resolution could have
changed. The execution record makes the test-to-region relation cheap to retain
and query.

## What decides whether it pays

Repository size determines how much evidence exists. It does not determine how
many tests a change selects.

A cluster of nearby files often shares one audience, so adding the fifth file
to a diff can cost little more than adding the first. A small shared utility can
be a hub reached by most of the suite, so changing one file can correctly select
almost everything. The useful adoption question is therefore not only “how
large is the repository?” but “how often do our changes touch hubs?”

One recording can answer that with your own suite. Run selection against recent
diffs and inspect the reported test counts. The result describes the saving your
dependency and test shape permits; it does not extrapolate from repository size
alone.

For the measured byte counts, latency, memory ceilings, worst-case unshared
sets, source-index sizes and lexicon costs, continue to the
[scale reference](scale.md). For the situations that deliberately widen a run,
return to [running less of the suite](selecting.md#where-selection-widens).
