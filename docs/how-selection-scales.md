# How the test-to-code map stays small

Selection needs to know which tests covered which code. Recorded naively that is
one entry for every test against every line it touched, which no large
repository can store. [Variance Authority](README.md) records it differently, and
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
forgets: **which tests covered the code that changed?**

During a run, [execution recording](execution-record.md) divides each module
into regions: the module itself, function bodies, branches, loop bodies,
continuations and handlers. A test records whether it covered a region. It does
not retain how many times the region ran, because selection needs presence, not
frequency. One test covering one region is a **crossing**, and the record is the
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
suggests. A test covers a barrel, and through that barrel it covers a large
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
132 MB. The same relation written as bare integer pairs has a floor of 2,561 MB.

Read that ratio for what it is. The fixture's *sharing* axis — which test
covered which module — is synthesized, so it tells you how many bytes and how
much memory a repository of that size costs, and it is not evidence about how
well your own imports share. If your repository shared nothing at all, and every
one of the fixture's 1.6 million regions had its own set, the record would be
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

## Every record names a module by its path

Many tools avoid shared naming state by deriving identity from the thing itself:
a stable hash of its content or path, or a deterministic filename. Two tools can
meet the same input independently and compute the same name. Variance Authority
uses the plainest form of that. A module is named by its repository-relative
path everywhere: the transform writes the path into the instrumented code as a
literal, a worker journal names each module a test file ran by its path, and
every record a run writes names the module the same way.

A path is wide, so a record file stores each one once. It keeps one table of
every string it uses — module paths, test files, test names, region names —
sorted by code unit, and every column refers to a string by its row in that
table:

```text
record file
  strings   sorted, each once   "src/cart.ts", "src/cart/total.ts", …
  modules   one string row per module
  regions   module, lines, set id
```

The rows are small integers, so millions of crossings stay cheap, and they mean
nothing outside the file that wrote them. That gives you three things:

- **A record reads anywhere.** Copy one CI shard's `journeys.bin` to your
  laptop and it answers which tests ran which lines of which file. It needs no
  cache, no [source index](source-index.md) and no table from the machine that
  wrote it.
- **Two records join by path.** Two tables sorted in the same order join in one
  pass over both lists, with no numbering to agree on first. A record and the
  source index join the same way.
- **Nothing is renumbered.** A record never depends on a number assigned
  somewhere else, so no later run, second checkout or restored cache can make it
  describe a different file.

The price is the string table, which is the largest single part of a journey
file. The worker journals a run leaves behind also name every module by its
path, so they are larger than the record folded from them; the fold removes them
when it finishes.

## One edit becomes one narrow read

When a function changes, selection follows a short path through that structure:

```text
changed lines
    ↓
module and execution region
    ↓
set id
    ↓
tests that covered the region
```

Region boundaries matter here. An edit wholly inside a handler can select the
tests that covered that handler instead of every test that rendered the
containing component. An edit on a line shared with the enclosing function
correctly selects the wider audience. The
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
execution record   what did each test actually cover?
                         ↓
                    selection
```

The source side follows dependency possibility. The execution side supplies the
smaller observed audience. Selection skips only tests the record saw run whole,
and names each changed file the record says nothing about. Missing evidence
costs more work; it does not become permission to skip an unobserved test.

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
