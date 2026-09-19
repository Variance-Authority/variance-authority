# How the test-to-code map stays small

Selection needs to know which tests entered which code. Recorded naively that is
one entry for every test against every line it touched, which no large
repository can hold. [Variance Authority](README.md) records it differently, and
you want to know what that costs before you put it on a tree that size.

This page answers that: what the relation between tests and code is, why it does
not grow as one stored row per test per line, and what every figure here was
measured on. Two recordings produce all of them — [Material
UI](https://github.com/mui/material-ui)'s own Vitest suite, and a synthetic
fixture scaled up from that recording to 200,000 modules — and each figure says
which one it came from, because they predict different things for you. The
[scale reference](scale.md) keeps the full tables and their boundaries.

## The relation selection needs

[Test selection](selecting.md) needs an answer ordinary coverage deliberately
forgets: **which tests entered the code that changed?**

During a run, [execution recording](execution-record.md) divides each module
into regions: the module itself, function bodies, branches, loop bodies,
continuations and handlers. A test records whether it entered a region. It does
not retain how many times the region ran, because selection needs presence, not
frequency. One test entering one region is a **crossing**, and the record is the
whole set of crossings your suite produced.

Conceptually, that produces a relation like this:

```text
cart.test.ts      → Cart/module
cart.test.ts      → Cart/render
cart.test.ts      → Cart/applyDiscount
checkout.test.ts  → Cart/module
checkout.test.ts  → Cart/render
```

This is the useful truth: a changed line leads to the tests that previously
exercised the region containing it. It is also the expensive truth if every
arrow becomes a stored pair — multiply modules by regions by test files on a
large repository and the crossing count runs to hundreds of millions.

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

The repeated relation is not compressed four times; it is represented once. That
factorisation is what keeps the record small, and varints and general-purpose
compression only improve the result after the larger duplication is gone.

On the 200,000-module fixture — 2,000 test files, its module paths, region
counts and region spans drawn from the Material UI recording — 671 million
crossings resolve to 3,408 distinct test sets, built, stored and queried inside
132 MB. The same relation held as bare integer pairs has a floor of 2,561 MB.

Read that ratio for what it is. The fixture's *sharing* axis — which test
entered which module — is synthesized, so it tells you how many bytes and how
much memory a repository of that size costs, and it is not evidence about how
well your own imports share. If your repository shared nothing at all, and every
one of the fixture's 1.6 million regions held its own set, the record would be
386 MB at a 510 MB peak: still one process, still under what a test runner is
already using. That is the ceiling to plan against, because it does not depend
on your repository being shaped nicely.

## Why the record is columnar

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

Large columns are split into independently compressed runs. A lookup opens the
header, locates one module, reads the region rows for the changed lines, follows
their set identifiers, and decodes only the corresponding test sets. Nothing
loads the file or constructs objects for unrelated modules.

The layout follows the question the record must answer:

- repeated values become dictionary identities;
- fields are stored by column rather than by object;
- columns are divided into independently readable runs; and
- a query reads only the columns and runs that can answer it.

## Small numbers need a shared names database

Many tools avoid shared naming state by deriving identity from the thing itself:
a stable hash of its content or path, or a deterministic filename. Two tools can
meet the same input independently and compute the same name. The name is wider,
but it travels inside the artifact and needs no earlier agreement.

Variance Authority makes the other trade at the busiest part of the record. Its
instrumented modules and crossings carry small assigned numbers, not hashes or
paths. The number cannot be recomputed from the module: its meaning lives in the
repository's **module names database**, a file called `names.bin` in your cache
directory.

```text
derived identity              assigned identity

path ──hash──▶ identity       names database: path ◀──▶ number
any tool can recompute it                     │
                                              └──▶ instrumenters, journals,
                                                   records and queries
```

Every generation and tool using the compact form must therefore share one
numbering lineage. Number `41` means nothing by itself; it means the path that
this database assigned `41`. What that gives you is a small, compressible
integer repeated across millions of crossings instead of a path or a uniformly
distributed digest. A digest spends its full 64 bits at every crossing and
cannot spend fewer; 200,000 modules hold 17.6 bits of module, and a sorted run
of exact numbers is a run of small gaps, which compresses.

The database keeps one promise you can rely on: **adding a file never changes
the number of a file that already has one.** Add a module in the middle of a
directory, rename a sibling, grow the repository by a thousand paths — nothing
already numbered is renumbered.

Paths are stored in sorted order, so a lookup can binary-search them and so
neighbouring paths share a prefix worth front-coding away; on 200,000 monorepo
paths that is 22 bytes a path against 50 stored plainly. If the number were the
position in that order, every insertion would shift every path after it, and an
earlier run's record would describe modules by numbers that now mean different
files. So the number is a column beside the sorted paths rather than the
position of one:

```text
sorted order          id column
  src/cart.ts            41
  src/cart/total.ts     903   ← added later, appended
  src/checkout.ts        42
```

A new path takes the next unused number and is written into its own sorted
place.

Only one direction is asked of the table. A build has a path and needs the
number to emit, which is the binary search above. Going back — number to path —
does not go through the table at all: the module record a build writes as it
instruments a module carries the path and the number together, so whatever reads
that record already holds both.

The failure a stable number prevents is not a crash. The coverage file is a set
of crossings between test identities and module numbers, and nothing in it
restates a path. If a number were silently reassigned, the file would still
load, still answer, and answer about the wrong module — selecting the tests
that entered `cart.ts` for a change in `checkout.ts`, and skipping the ones
that matter. A stable number is what makes evidence from an earlier run usable
by a later one.

Growth keeps the property through a log-structured merge design. The database is
a chain of immutable segments under one atomic manifest: an append adds a
segment holding only new paths, and compaction merges the chain into one sorted
run without disturbing a single number. Reads touch immutable files, so parallel
transforms need nothing from one another; only the fold that assigns new numbers
writes, under an exclusive lock.

### Moving the numbering authority between checkouts

`names.bin` can travel beside the execution record through a CI cache, a shared
directory or an artifact transfer, and a consumer restoring both reads the same
compact numbers the producer wrote. Two tables grown independently — on two
machines, or in a checkout that never saw the first — number the same repository
differently and have no way to agree, so a record travels with the table it was
numbered against. Within one lineage the number is permanent for as long as the
file exists.

If you run tests from a second checkout of the same repository, a git worktree
takes its copy of the table from the primary checkout's cache the first time it
needs one, and continues that numbering in a writable layer of its own, so it
neither renumbers the repository from zero nor writes into the checkout it was
cut from. A checkout whose relationship to a primary checkout cannot be
established keeps its own table instead, and that table is a separate lineage.

Nothing moves the file for you. There is no service that hands out numbers and
no sync that notices two caches have diverged: transporting `names.bin` with the
record is a step you arrange, the same way you arrange the record's own
transport. [Sharing evidence](sharing.md) covers the transport shapes, and the
[execution-record reference](execution-record.md#the-module-names-table) owns
the exact format and lookup costs.

This dependency is about reuse, not availability. A missing, foreign or corrupt
table is an empty table: every module is unnumbered for one run and numbered
again by the fold, and you pay the cold cost. What you must not do is reuse
compact numeric evidence while silently assigning those numbers a different
meaning.

A module the table has never seen — a file created since the last run — is
instrumented under its path instead, because a transform cannot wait for an
authority to hand it a number. The run is correct with one module costing
path-length bytes at its crossings, and the next fold numbers it permanently.

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

The two recordings show what a question costs at each size:

| | the 200,000-module fixture, a 77 MB file | Material UI, a 0.5 MB file |
|---|---|---|
| opening it | 43 KB read | 1.8 KB read |
| answering a 100-file diff | 3.7 MB in 498 reads | 0.26 MB in 23 reads |
| as a share of the file | under 5% | 53% |

The share you read falls as your repository grows, which is the opposite of the
usual direction. A small record is mostly header and dictionary, so a question
reads half of it. A large one is mostly rows about modules your diff did not
touch, and those are never decompressed. Cold, in a new process that opens the
77 MB file and answers the diff, the whole command is under a tenth of a second
and about 120 MB resident.

One question is more expensive than any ordinary run asks: every module against
every test, which is how you find your **hubs**, the files most of the
repository imports. At 200,000 modules that is four seconds and 322 MB — a
ceiling you can afford to hit deliberately.

## The source index keeps the answer honest

Runtime evidence describes the source the tests actually ran. It cannot, by
itself, know that today's edit introduced a new import path or changed a
relationship the previous run never observed.

The [source index](source-index.md) supplies that other half:

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

The source index uses a related storage shape — interned strings, columnar
sections and immutable segments — for a different reason: it makes repeated
scans cheap and invalidates records when source resolution could have changed.
On the 200,000-file synthetic shape it occupies 67.3 MB.

## What decides whether it pays

Repository size determines how much evidence exists. It does not determine how
many tests a change selects.

A cluster of nearby files often shares one audience, so adding the fifth file to
a diff can cost little more than adding the first. A small shared utility can be
a hub reached by most of the suite, so changing one file can correctly select
almost everything. The adoption question is therefore not only "how large is the
repository?" but "how often do your changes touch hubs?"

No figure on this page answers that for you, and the fixture cannot: its sharing
axis is synthetic. One recording of your own suite can. Record a run, then ask
[`variance select --format json`](../packages/cli#select-what-your-own-runner-may-skip)
about your recent diffs and read the counts it returns. That result describes
the saving your dependency and test shape permits, measured rather than
extrapolated from repository size.

For the remaining measured byte counts, latency, memory ceilings, worst-case
unshared sets, source-index sizes and [lexicon](lexicon.md) costs, continue to
the [scale reference](scale.md). For the situations that deliberately widen a
run, return to [running less of the suite](selecting.md#where-selection-widens).
