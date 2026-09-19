# The execution record

This page is the reference for the file your suite writes when it runs. The
record says **which parts each test actually entered**, so a changed line can
select from witnessed execution instead of every test a static import graph can
reach. Blocks, the coverage file, and journals make that distinction queryable.

Read on for where the file lands, what to import to read it, what each
structure's primary key is, how a fact traces back to the line or test that
produced it, and what a lookup, merge and append cost.
[`selecting.md`](selecting.md) says what a run does with the answer;
[`source-structures.md`](source-structures.md) covers the static side this page
joins with.

Throughout, `T` is the number of tests the record lists, `M` the number of
modules, `B` the number of blocks in one module, `P` the total number of
preconditions, and `C` the number of crossings, one per test that executed a
block.

## Where the file is, and what to do with it

Find it with `testCoverageFile(root)`, or with `readableTestCoverage(root)` when
you want the nearest snapshot a worktree can actually read:

```
<cache>/variance-authority/test-selection/<repository-digest>/coverage.bin
```

`<cache>` is `XDG_CACHE_HOME`, or `~/.cache` when that is unset.
`<repository-digest>` is a digest of the checkout's absolute path, so two
checkouts never write one another's bytes. A worktree writes its own layer under
`.work/<workspace-digest>/` beneath that directory and reads the primary
checkout's as a fallback, so a worktree cut this morning inherits what the
repository already recorded instead of re-transforming it.

**Do not commit it, and add nothing to `.gitignore` for it.** The default path
is outside your work tree: `git status` never sees it, `git clean` never takes
it, and it never lands in a pull request. The one case that needs an ignore
entry is one you create — pass `coverageFile` to a runner integration to put
the snapshot at a path you name, typically inside the repository so CI
can upload it as an artifact, and then ignore that path. Turning on `cases`
writes a second file at `<coverageFile>.cases.json`, under the same rule.

Three more things live under that directory. Each instrumenting build keeps a
store of module records under a `<label>` of its own; the module names table is
`names.bin` beside the snapshot; and a run in progress keeps a
`.run-<pid>-<uuid>` directory there until its reporter folds the journals and
removes it. The Jest seam keeps its record store under Jest's own
`cacheDirectory` instead, so a cached transform and the meaning of its ordinals
are discarded together.

Delete any of it and you pay one full run. A missing, foreign or corrupt file is
read as an absent record rather than an empty one, so a selector widens to the
whole suite instead of narrowing on damage.

## What each host records

Five hosts write this file, and they write the same structures into it. What
differs is the owner of an observation — the key a crossing joins, which is
whatever that host schedules — and where the bracket goes when you turn `cases`
on.

| Host | An observation is owned by | `cases` brackets |
|---|---|---|
| Vitest | the test file | the asynchronous scope of each case, so cases in flight together stay apart |
| Jest | the test file | the body of every injected `it` and `test`; a file that sets `injectGlobals: false` records one bucket for the whole file |
| Rstest | the test file | `it` and `test` wherever the suite reads them — off the realm, or off the object an import of `@rstest/core` compiles to |
| Playwright | the spec file | the test, which is already the window the driver closes |
| Storybook | the story | the story, which is already the unit the preview shows |

None of them asks you to change a runner option to record cases, and the
snapshot is byte-identical whether you record them or not — the case axis is a
second file beside it.
[Own fewer tests](own-fewer-tests.md#ask-which-tests-claim-a-line) is the
question that reads it.

Two answers are properties of this file rather than of a host, so they read the
same under all five. A run that transformed nothing, because every module came
from a warm cache, still records what its tests entered: what a region means is
stored per module under a content key, and a run joins those records rather
than producing them. And an observation that did not finish is dropped from the
pool rather than counted as a miss, so nothing a host retries or interrupts can
justify a skip.

## Reading the snapshot yourself

No `variance` subcommand dumps the snapshot. The CLI reads it to answer
questions — which tests a change reaches, where two subjects parted — and prints
those answers, never the rows. To see the rows, decode the file in process:

```ts
import {
  readTestCoverage,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';

const coverage = await readTestCoverage(testCoverageFile(process.cwd()));

for (const module of coverage.modules) {
  for (const block of module.blocks) {
    console.log(module.file, block.kind, block.name, block.path, block.testFiles);
  }
}
```

`readTestCoverage` decodes the whole file into `TestCoverage`, the model the
rest of this page describes: tests with their preconditions, modules with their
blocks, and on each block the test files that crossed it. Budget a second and
three hundred megabytes of heap for a repository-scale snapshot — thirty times
the file it came from — because the model is made of objects where the file is
made of columns.

When you want one module's regions rather than the repository's, open the file
instead of decoding it. `openCoverageFile(file)` parses the section index and
hands back a view whose columns decompress only when something in them is asked
for, plus the `close()` that releases the descriptor; `askCoverageFile(file,
ask)` is the same open with that close already written for you. Opening costs a
millisecond and half a megabyte resident, and answering a diff through the view
is single-digit milliseconds.

## What you can import

These names are the package's published surface. Import them, and the shapes
they return are the ones this page describes.

| Import from | Names |
|---|---|
| `@variance-authority/sense/instrument` | `instrument`, `instrumentationId`, `instrumentModeOf`, `INSTRUMENTATION_ID`, `EVALUATING`; types `Block`, `BlockKind`, `Instrumented`, `InstrumentOptions`, `ModuleId` |
| `@variance-authority/sense/test-selection` | `testCoverageFile`, `readableTestCoverage`, `seedTestCoverage`, `readTestCoverage`, `writeTestCoverage`, `writeCoverageBytes`, `openCoverageFile`, `askCoverageFile`, `selectTestFiles`, `narrowByExecution`, `mergeCoverage`, `foldTestCoverage`, `changedLines`, `coveringTests`, `coveringTestsInFile`, `recordedCommit`, `cacheLayers`, `defaultCacheRoot`, `layeredFiles`; types `TestCoverage`, `CoverageModule`, `CoverageBlock`, `CoverageTest`, `CoveragePrecondition`, `CoverageFile`, `CoverageShard`, `ExecutionIndex` |
| `@variance-authority/sense/journal` | `testSelectionProbes`, `drainExecution`, `recordExecution`, `joinObservations`, `EXECUTION_GLOBAL`; types `ExecutedModule`, `ExecutionJournal`, `EvaluatingPage`, `ObservedSubject` |
| `@variance-authority/sense/journey` | `collectJourneys`, `stitchJourneys`, `mintJourney`, `journeyOf`, `JOURNEY_COOKIE`, `JOURNEY_VARIABLE`, `JOURNEY_HEAD_VARIABLE`; types `JourneyAccount`, `JourneyReport`, `StitchedJourneys` |

Nothing else on this page is importable. Where the sections below describe the
encode, the merge or the lookup, they describe behaviour you can rely on through
those entry points, not functions you can call.

## The structures at a glance

| Structure | Primary key | Identity across runs | Lives |
|---|---|---|---|
| block | `(module path, ordinal)` | `kind`, `name`, `path` | module record, coverage |
| module | file path | the number the names table gave the path | module record, coverage |
| test | test file path, or a story id | the same | coverage |
| precondition | `name` and `digest` together | the same pair | coverage, per test |
| crossing | `(block, test)` | the same pair | coverage |
| module names table | repository-relative path | the number, for as long as the file exists | the repository's cache |
| module record | module id under a build label | the instrumentation id | the label's store |
| worker journal | one test file in one worker | none, folded on read | the run directory |
| page journal | one drain of one page | none, folded on read | the driver's memory |
| journey account | one delivery from one head | none, stitched by journey id | the wire, then the driver's memory |
| journey | one minted id | the id | a cookie, and the driver's map to its subject |

## Blocks

Call `instrument` to parse one module with `oxc`. You get back `Instrumented`:
the transformed `code`, the `sourceDigest` of the exact input, the
`instrumentation` id, and a `blocks` array in ordinal order. Each `Block`
has the ordinal, the kind, the owner ordinal, the digest, the name, the
path, and the start and end offsets in the original source. For a module the
parser cannot read you get `undefined` rather than an empty list, because *not
instrumented* and *no regions* are different facts — check for it.

**Kinds.** `module`, `function`, `branch`, `continuation`, `resume`, `loop`,
`case` and `handler`. In the coverage file the kind byte is that list's index,
so read it against this order. One rule generates the set: a block is a region that control
enters under exactly one condition, one the region around it does not imply.
Entering a `try` body follows from entering the region around it, so it is no
block; entering its `catch` does not, so it is.
Ternaries and the short-circuit operators stay inside the region that encloses
them.

**Ordinal.** The block's position in a pre-order walk of the module, and the
index of its counter in the runtime array. Ordinal `0` is the module root, the
only block without an owner. The ordinal is the key inside one instrumented
version of the module and means nothing across versions: inserting a function
above another renumbers everything after it.

**Owner.** The ordinal of the nearest enclosing block, so `owner`
chains lead every block to the root in at most depth steps. A continuation
owns what follows it, so the owner of the `if` inside a function that first
ran a loop is the loop's continuation, not the function's entry. The chain is
what gives a block its identity when ordinals shift.

**Name.** The declaration name path: the names of the functions and classes
enclosing the region, joined with `/`. A function takes its own identifier; a
method or a property takes its key; a function assigned to a variable takes
the variable; a closure passed as an argument takes `<callee>.arg<i>`; a
function with no name available takes `anon#<i>`, numbered within the
enclosing scope. `Cart/render/anon#0` and `applyTier/reduce.arg0` are names.
The module root's name is the empty string.

**Path.** The structural position inside that declaration. The module root
is `module`; a function's own body is `entry`. Decisions are numbered within the path that contains them:
`if#0/then`, `if#0/else`, `if#0/after`, `switch#1/case#2`,
`switch#1/default`, `try#0/catch`, `try#0/finally`, `for#0/body`,
`while#0/body`, `await#0`. A nested decision extends the path of the region it
sits in, and numbering is local to the containing path, so the first `if`
inside another's `then` arm is `if#0/then/if#0`. Two functions with one name
in one module are told apart by `name`, never by `path`: every function body
is `entry`.

**Digest.** `digestString` of the kind, a `NUL`, and the block's own text with
each child region replaced by a `NUL`-framed `kind:name:path` placeholder. So
the digest changes when the block's own statements change and does not
change when a nested region's body does: the condition of an `if` belongs to
the region around it, and editing the condition changes that region's digest
while editing one arm changes only the arm's. A synthesized region, an `else`
nobody wrote or a `default` nobody wrote, has zero width and digests to its
kind alone.

**Offsets.** `start` and `end` are offsets into the original source. The
record and the coverage file use lines instead, computed through the
bundler's source map when there was a transform before this one, so a diff
hunk lands on the file the author edited.

**Cost.** Cutting a module is one parse and one pass — 0.14 ms a module over
this repository's own source on one Mac, so a build that changed ten files
spends under two milliseconds carving them — and about two fifths of that is
already the platform's rather than this project's. `sense` takes SHA-256 from
`node:crypto` rather than the portable implementation `core` needs to
run inside a page, and takes the parsed tree straight out of `oxc`'s buffer
rather than through the JSON it would otherwise serialize and read back. The raw
transfer wants a 64-bit little-endian host and says so; where the answer is no
the same tree arrives the slower way, and every structure on this page is
identical either way.

### A worked example

The module below has eight regions. Instrumenting it adds text on existing
lines only; no line is added, so the lines a block covers are the
lines the author wrote.

```js
import { tax } from './tax.js';

export function total(items, premium) {
  let sum = 0;
  for (const item of items) sum += item.price;
  if (premium) return sum * 0.9;
  return sum + tax(sum);
}

export const label = (n) => n > 0 ? `${n} items` : 'empty';
```

The eight blocks, with the owner chain that gives each its identity:

| ordinal | kind | owner | name | path | offsets |
|---:|---|---:|---|---|---|
| 0 | `module` | | `` | `module` | 0–256 |
| 1 | `function` | 0 | `total` | `entry` | 71–194 |
| 2 | `loop` | 1 | `total` | `for#0/body` | 116–134 |
| 3 | `continuation` | 1 | `total` | `for#0/after` | 137–192 |
| 4 | `branch` | 3 | `total` | `if#0/then` | 150–167 |
| 5 | `branch` | 3 | `total` | `if#0/else` | 167–167 |
| 6 | `continuation` | 3 | `total` | `if#0/after` | 170–192 |
| 7 | `function` | 0 | `label` | `entry` | 224–254 |

Block 5 is the `else` nobody wrote: zero width, and still a place control
reached. Block 3's text spans from the statement after the loop to the end of
the function, and its digest is computed with blocks 4, 5 and 6 replaced by
their placeholders, so an edit to `return sum * 0.9` changes block 4's digest
and leaves block 3's alone. The loop header `for (const item of items)` is
block 1's text, so editing it changes the function's entry digest.

Ordinals run on through the module: `label` is block 7 because seven blocks
were opened before its body, and a third function would take 8. Both
functions count into one array, the module's, so the file has one counter
array of eight slots, not one per function.

Across test files the ordinals are the join key. Every worker that ran this
module reports hits against the same eight slots, and the fold unions them per
ordinal into the block's `testFiles`. `foldTestCoverage` unions the records of a
sharded run the same way, and refuses two shards that record the module under
two source digests, because their slot 4 would be two places.

### Identity under an edit

An ordinal is a slot in one instrumented version of a module, and it is not
what keeps evidence across an edit. What keeps it is the region's address: the
declaration name path and the structural path inside it, which say where the
region sits in the module's tree rather than where it sits in the module's
text. `mergeCoverage` moves a crossing from the previous record onto the
region with the same address, and the digests take no part in that.

So renumbering is not invalidation. Inserting
`const price = (item) => item.price;` after `let sum = 0;` opens
`total/price` at ordinal 2 and moves everything after it up by one — the loop
body to 3, `label` to 8. Inserting a top-level
`export function count(items) { return items.length; }` moves `label` to 8 the
other way. In both the record keeps every crossing it had, because
`total/if#0/then` is still `total/if#0/then`.

A crossing is dropped only when the new text has no region with its address:
a function renamed, a decision deleted, an arm that is now a loop. Even that
rarely retires a test. Arrival nests — a test reached a region by entering
every region around it, up to the module — so a test whose function was
deleted still has crossings above it, and a diff at the place that function
was reaches it through them. Only a test that loses every crossing in a module
is demoted to incomplete and selected whole next time.

**A digest that changed is selection's business, not the merge's.** It says the
region's own text changed, and the tests to run are the ones recorded against
that region — which is the crossing. Reading a digest as a reason to discard
the crossing would throw away the evidence the change is about to be answered
with, and reading the owners' digests too made any edit at a module's top level
retire every crossing in the file.

| edit | crossings kept | the kept test's row |
|---|---|---|
| function added inside `total` | every one | whole |
| function added at module level | every one | whole |
| body of one `if` arm edited | every one | whole |
| `total` renamed | those of the root and `label` | whole |

**A module the run did not load** stays in the record, and its rows are lines
of the text it had when it was recorded. When that text has since changed, the
regions are read out of the text standing there now and each crossing is
moved onto the region with its address, so the rows are in coordinates the
next diff will be in. A module whose text cannot be read as source has no
table to place them in: it stays as it was, and every test that entered
it is demoted.

### From a crossing back to a line

The record joins a block to the file two ways. `sourceDigest` on the module
row names the exact text the ordinals were cut from, and `startLine` and
`endLine` on each block are lines of that text. A diff is charged to lines, a
line lands on the blocks whose range covers it, and a block yields the tests
that crossed it; the procedure is in *Tracing a diff to tests* below.

So whether a change to a handler runs any test depends on where the
edited line sits. Take a component whose render function defines a two-line
`toggle` closure and a one-line `onClick` arrow, recorded with one test that
clicked and one that only rendered:

| edited line | charged blocks | selected |
|---|---|---|
| a line inside `toggle`'s body | `Button/toggle` only | the test that clicked |
| the line `const toggle = () => {` | `Button/toggle`, then `Button` | both |
| the JSX line with `onClick={() => …}` | `Button/anon#0`, then `Button` | both |

A line that is a region's first or last line is also the enclosing region's
text on that line, so the charge extends outward and the tests that merely
rendered are selected. An edit that lands on a line belonging to the handler
alone charges the handler and nothing wider, and a handler no test crossed then
selects no test at all. A one-line handler has no such line, so every edit to
it runs the tests that reached the component.

**Added text is charged for what it does.** An insertion has no line of its
own in the text the rows are coordinates in, so it is charged to the lines on
either side of the gap it opens — and at a module's top level both of those are
the module, whose crossings are every test that ever imported the file. The
diff includes the added text, so the question is asked of the text instead: a
type, an interface, a signature with no body, a type-only import, a comment,
each of them erased before the module runs, which leaves the text that was
already there the whole of what ran, so the hunk charges nobody. A function
declaration is not on that list, because it hoists: it binds its name at the top
of the block the text landed in, over whatever value that name had there, and
the lines above it are the ones the hunk did not touch. Neither is a class
declaration, whose decorators, computed keys, static initializers and base
expression all run, nor an enum the compiler emits, whose function merges into
whatever object its name already refers to, nor a `const`, whose initializer
is work every importer of the module consumed.

## The coverage file

The file you located above declares two numbers. One is the
model version: what `TestCoverage` means, stated by a producer and passed
through a merge. The other is the byte layout, which changes when the model
does not; a file written under another layout is refused rather than
reinterpreted. The container is a `u32` little-endian
header length, a JSON header `{ version, sections }` padded with `NUL` so the
payload starts on an 8-byte boundary, and then the sections. Each entry in
`sections` gives `name`, `offset` from the start of the payload, `length` in
bytes, `width` — one byte for `strings.blob` and the flag and kind columns,
four for everything else — and `rows`, present only on a section stored as
runs. Every section starts on an 8-byte boundary.

Every section is a column, and the columns of one group are indexed by the same
row number. Read a column whose name ends in `.off`, or one described below as a
range, as a compressed sparse row offset column with one more entry than the
parent has rows: child rows for parent `i` are `[off[i], off[i + 1])`.

| Group | Column | Contains |
|---|---|---|
| strings | `strings.blob`, `strings.off` | one UTF-8 dictionary, code-unit sorted, referenced by id everywhere else |
| snapshot | `snapshot.instrumentation` | one string id, the instrumentation the whole file was produced under |
| snapshot | `snapshot.commit` | zero or one string id, the commit the record describes |
| tests | `tests.path` | the test file path, sorted by code unit |
| tests | `tests.complete` | one byte, `1` when every case in the file ran and passed |
| tests | `tests.preconditions` | range into the precondition rows |
| preconditions | `preconditions.name`, `preconditions.digest` | a path the test's answer depends on, and the digest it had |
| modules | `modules.path`, `modules.source` | the module path, sorted by code unit, and the digest of its source |
| modules | `modules.instrumented` | one byte, `1` when the module has blocks |
| modules | `modules.blocks` | range into the block rows |
| blocks | `blocks.ordinal`, `blocks.kind`, `blocks.owner` | position, kind byte, and owning block's ordinal, `0xffffffff` at the root |
| blocks | `blocks.digest`, `blocks.name`, `blocks.path` | identity, as string ids |
| blocks | `blocks.start`, `blocks.end` | first and last line in the source |
| blocks | `blocks.source` | one byte, `1` when the block is a region of the file's text |
| blocks | `blocks.set` | the pooled set of tests that executed the block |
| blocks | `blocks.loadedSet` | the pooled set of tests that had executed the block before their own file began, empty for most regions |
| sets | `sets.blob`, `sets.off` | the pool both of those name: one copy of each distinct set of tests, however many regions name it |

**Runs.** A section over sixty-four kilobytes is cut into runs — four thousand
and ninety-six rows of a column, five hundred and twelve strings of the blob —
and each run is compressed on its own. Nothing smaller than a run is
addressable and nothing larger than one is decompressed to read a row, so a
reader that wants the crossings of one region pays for one run and a reader
that wants none pays for nothing. A numeric column is delta coded, zigzagged
and written as varints before it is compressed: these columns ascend almost
everywhere — offsets into the blob, line numbers down a file, the test ordinals
inside one region — and a delta of an ascending column is a small number where
the value was a large one. Deltas are zigzagged because a delta is signed. One
byte per row is already a delta of nothing, so a flag column is compressed as it
stands.

Bytes are what a read costs, so the size rule and the speed rule pick the same
runs. A decoder's work is the compressed bytes it walks, so the run that
compresses to a fifteenth of itself is also the cheapest run to read — eleven
microseconds against the six a bare varint run costs — and the run that resists
compression is the expensive one, at nineteen, for a fifth off its size. That is
why the threshold is stated as a size: a section is stored as runs only when the
runs come out smaller than the column was, and a run compression would have
expanded is kept as the bytes it already is. Compressing what does not compress
buys nothing in either currency. Zstd at two levels, because the runs are two
kinds of data: six for the varints, one for the string blob, which is file paths
and hex digests and gains nothing above it. Against brotli at quality 4 over the
same twenty thousand columns, that is 319 milliseconds of compression down to
120 and a file 86 kilobytes smaller — the blob alone was 187 milliseconds and
7.169 megabytes, against 30 and 7.083. It costs a floor of Node 22.15, which is
where `zlib.zstdCompressSync` arrived. A repository of twenty thousand modules,
six hundred thousand regions and eight million crossings is ten megabytes this
way, a twenty-fifth of what the same snapshot costs as objects, and two thirds
of what is left is the string dictionary.

`TestCoverage` is the model you get from `readTestCoverage`: tests with their
preconditions, modules with their blocks, and on each block the test files that
crossed it. Rebuilding it from the columns is O(bytes). Opening the file with
`openCoverageFile` does not rebuild anything — it parses the section index,
checks that the row counts agree, and gives you a column per section that
decompresses when something in it is asked for. A column answers by the row or
answers whole, and choosing between the two is the difference between reading
one module's regions and reading a repository's. A run reads through the view,
because a selection touches a few modules and never needs the whole model.

The gap is not the decompression. On the snapshot above, opening the file is a
millisecond and half a megabyte of resident memory, answering a diff is single
digit milliseconds, and materializing every column of it — thirteen million
values, each one checked on the way out — is a seventh of a second. Turning
those same values into the objects `TestCoverage` describes is a second and
three hundred megabytes of heap, thirty times the file they came from. Columns
are cheap in both currencies and objects are expensive in both, which is why a
query reads columns and the model is something a caller asks for by name.

What makes the model expensive is repetition rather than size. A path is named
again by every region of its module and again by every crossing that entered
one, so a decode keeps one string per id and hands that one to every use of it.
Decoding each use on its own costs twice the time and close to three times the
heap, for a model that says exactly the same thing.

**Location.** [Where the file is](#where-the-file-is-and-what-to-do-with-it),
above. Beside the snapshot, each instrumenting build keeps what it instrumented
as one record per module in a store named by that build's `<label>`; the
ordinals in the snapshot mean nothing without it.

## The module names table

The id is assigned rather than derived. The table that assigns it is `names.bin`
beside the snapshot.

**Why a number.** An id is written once into a module's emitted code and then
repeated once per crossing, and crossings are where the cost is: this
repository's suite records two hundred and eighty thousand of them against
eight hundred and fifty modules. A digest spends sixty-four bits at every one
of them and cannot spend fewer, because a digest is uniformly distributed: a
sorted run of them has gaps as wide as the space, and measures 64.00 bits an
element under zstd, which is the same as not compressing it at all. Two hundred
thousand modules come to 17.6 bits of module. Numbering them exactly spends
eighteen, and a sorted run of exact numbers is a run of small gaps, which is a
run that compresses.

**Shape.** Paths sorted and front-coded — each entry keeps only the bytes it
does not share with the one before it — with a whole path every sixteenth
entry, so a lookup binary-searches the block heads and then walks at most
fifteen entries. On two hundred thousand monorepo paths that is 22 bytes a path
against 50 stored plainly. The id is a column beside the entries rather than
the position of one, which is what lets storage order be the sorted order:
nothing about where a path sits decides what it is called, so a file added
today renumbers nobody numbered before it.

**Growth.** The table rides the immutable log
([`source-structures.md`](source-structures.md) has its shape): an append is a
new segment listing only the paths that are new, published under one atomic
manifest, and a compaction merges the chain into one sorted run without
disturbing an id. A lookup binary-searches each of the at most eight segments
in a chain.

**Who assigns.** The fold, at the end of a run: the runner's reporter in its
parent process, or — where the fold is one of several processes writing one
index — under the same lock the coverage merge takes, because the table is
read-modify-write too and two folds appending at once would each read the same
count and hand one number to two paths. Transforms only read, and a read is a
read of an immutable file, which is what makes the table safe under a build
that transpiles ten changed files in ten processes while a hundred and
ninety-nine thousand stay cached. New paths are numbered in sorted order rather
than in the order they were met, so two machines that meet the same set of new
files agree on what to call them and cache the same emitted code.

**A path with no number.** A transform has to write an id into the code it is
emitting, right then, and only the fold at the end of a run may hand out a new
number. So a transform that meets a path the table has not numbered emits the
path itself, which identifies the module exactly as well and needs no table. The journal reports
it, the fold recognises a path rather than a number, numbers it for next time,
and the run is correct with one module paying path-length bytes at its
crossings. Nothing is reserved and nothing is claimed, so two processes that
meet two new files at the same moment cannot collide.

**A table that is lost.** A missing, foreign or corrupt chain is an empty
table: every module is unnumbered for one run and numbered again by the fold,
from zero. The emitted id is part of the Jest transform's cache key, so no
worker serves text that names a number the table no longer agrees with, and a
record appended under a reused number is the later frame and the one a reader
takes. Persistence is a saving, never a new way for a run to fail.

## Keys

**Test.** The owner of an observation: the test file's repository-relative
path under a Vitest, Jest, Rstest or Playwright run, because the runner's unit
of scheduling is the file, and a story id under Storybook, because a story is
selected on its own. Two observations of one owner in one write are refused as
a duplicate.

**Module.** The module's repository-relative path, with `modules.source` as
the digest it must still have for its blocks to mean anything.

**Module id.** A `u32`: the number the names table gave the module's path, and
what an instrumented module reports itself as. A module the table had not
numbered when it was transformed reports its path instead, and the record filed
under a reserved unnumbered marker answers for that path until the fold numbers
it. Both are one `ModuleId`, ordered numbers first and then paths, so two folds
of one run write one sequence.

**Block, within a file.** `(module row, ordinal)`. Ordinals are unique within
a module and the first block is the module root.

**Block, across files.** `name`, `path` and `kind`: the address, and what kind
of region sits at it. `mergeCoverage` matches `name` and `path`, and then asks
the one remaining question, whether the kinds agree. Nothing above the block
enters the match and neither does its digest, so a block keeps its crossings through every edit that leaves it where
it is. A block with no match in the new table is gone, and what was recorded
against it is dropped.

**Precondition.** The pair of path and digest, kept unique per test by the
concatenation `name`, `NUL`, `digest`. A test's preconditions are the files
its answer depended on that the instrument could not see inside: the test
file itself, configuration, fixtures, and modules that were loaded but not
instrumented.

**Crossing.** `(block, test)`. The record stores presence, not counts: a test
crossed a block or did not. Counts exist only in the runtime array and are
gone once the journal is written.

## Finding a row

Ask for a module or a test by path and you pay a binary search: it is found by binary-searching the sorted path column, decoding
one string per probe: O(log M) or O(log T) decodes. A block by ordinal within a
module is a linear scan of the module's block range, O(B).

The tests that crossed a block are the rows `crossings.test[blocks.tests[b]
.. blocks.tests[b + 1])`, O(crossings of that block).

The tests a changed uninstrumented file governs come from a walk of every
precondition row once, O(P), returning the tests by row with the names that
matched. A file no precondition names comes back as unread, which is the signal
that the record does not know it.

The preconditions of a test are the rows `tests.preconditions[t] ..
tests.preconditions[t + 1]`, O(preconditions of that test).

## Tracing a diff to tests

`selectTestFiles` performs the trace one changed file at a time. Each step
below is one stage of that call.

1. **Diff to lines.** `changedLines`, which you can also call on its own, reads
   the old side of each hunk: context lines are not charged, a pure insertion charges the line
   before and the line after, deletions charge the removed lines, a renamed
   file is read under its old name, and a file with no hunks is charged
   whole. The added text of an insertion is kept with the range it charges.
   O(diff length).
2. **Added text the module never runs.** The added text of each such range is
   parsed. A range whose text is nothing but types, interfaces,
   signatures with no body, erased enums, type-only imports and a re-export of
   a name the file already has is dropped before anything is charged: none of
   it is evaluated where the code that already ran could use it. Text that
   parses to no construct at all — a comment, a blank line — is *not* dropped,
   because the same bytes at the same line number are equally a line of the CSS
   or the copy a module renders out of a template literal, and a diff offers no
   coordinate finer than the line. One parse per inserted run.
3. **Lines to blocks.** Each charged line costs one scan of the module's
   blocks, O(B). Every synthesized region containing the line is charged. Source
   regions containing it are grouped by span, and the narrowest group is
   charged whole. Each wider group is charged in turn as long as a region of
   the group just charged extends outward, which means its text on that line
   sits beside the wider region's text. A region extends outward when the line
   is its first line, except that the module root and a continuation never do,
   a function also does when the line is its last, and a resume does only when
   no region of another kind has its span. A line no source region contains
   charges every block of the module.
4. **Blocks to tests.** Each charged block's crossings, O(C of those blocks),
   of every row recorded under the path — two builds that read one module are
   two rows, and the answer is all of them. Every changed path is also asked of
   the precondition table, O(P), whatever its rows say: a row answers which
   tests entered which regions, a precondition says the observation is void if
   the file's text changes at all, and the two are not the same sentence. A row
   does buy the path out of *unread*, which is why a module nothing declares is
   still measured.
5. **Files the record cannot see.** Hand the relations graph in through
   `options.relations` and every changed file is also asked of the graph. It
   answers only for a file no probe can sit in: it walks the
   graph from the file to its importers along `asset` edges, the kind the
   source scan records for such a file, and selects the tests that crossed or
   precondition on any importer it reaches. The file is answered only when
   every chain of the walk ends at something the record measured — a test, a
   module with probes, or a module without probes that some test declares; a
   chain ending at a module with no row leaves the file unread whatever the
   other chains selected. When something imports the file as an asset, every
   file whose edges are unknown is charged as well, as an addition that
   neither answers nor unsettles. O(n + m) on the graph per changed file.
6. **Unread.** A changed path is measured only when *every* name the caller
   says the snapshot may list it under was answered for by a module row, a
   precondition or a chain to a recorded importer. One file is often two names
   — a package's own suite loads `src`, every other package loads the built
   twin — and the two serve different audiences, so a row under one name
   witnesses nothing about the tests that loaded the other. A path any of whose
   names went unanswered, and a path the caller gives no name at all, is
   reported as unread, and the caller runs everything. A name with a row is
   answered even when no test names it: the row is the measurement.

The whole trace is O(diff length + inserted text + B per changed module + C of charged blocks
+ P), and one graph walk more per changed file when a graph is supplied.

## Tracing a test to what it depends on

Going the other way costs you one row read. A test's preconditions name the files
whose change must re-run it without any block being involved, and its
crossings are the inverse of `crossings.test`: the blocks whose crossing range
contains the test's row. The file has no index in that direction, so listing
every block a test crossed is O(C) over the whole record. `ExecutionIndex` is
the same data in the shape a collector or an editor integration supplies: each
block lists the tests that crossed it with the call-stack depth from the test to
the block. Pass one to `coveringTests` to ask by line or by function name, at
O(M) to find the module and O(B²) to keep only the innermost regions of the
line.

## Tracing a block to its place

Take a block row and you have its module row, its ordinal, and its owner
ordinal. The
owner chain is followed by finding the owner's row inside the module's block
range, O(B) per step, at most depth steps. `name` and `path` together read
as a location without the chain: the declaration and the structural position
inside it. `start` and `end` place the block on the lines of the source at
`modules.source`. When the file on disk no longer hashes to that digest the
lines are the record's, not the disk's. A merge notices that and re-cuts the
rows over the text that is there. A file it cannot read at all is treated
differently from one that is not there: a path that has gone leaves the
module to be answered for by name, and a path that refuses to be read retires
the observation instead of keeping it over text nobody has seen.

## Journals

Every runner seam records what one process saw and leaves the fold to the
writer. Read this section when you are wiring a runner yourself; a suite using
the shipped Vitest, Jest, Rstest, Playwright or Storybook seams never sees one.
Three journal shapes exist, and each includes a list of `ExecutedModule`; the
record that gives their ordinals meaning is the fourth shape here:

```json
{ "id": 5104, "hits": [0, 1, 2, 3, 5, 6], "shared": [0], "loaded": [0, 1] }
```

`id` is the id the module was instrumented under — its number, or its path
until it has one — `hits` the ordinals whose counter was above zero, ascending,
and `shared` the subset of `hits` whose counter had the `EVALUATING` bit set.
`loaded`, in the worker journal only, is the subset of `hits` whose counter was
already above zero in the snapshot the setup file took before the file's first
test: regions entered as a consequence of loading. Presence only: the counts
never leave the process. The ordinals index the recipe the build instrumented
under — `sense:instrument/presence-v4`, or `sense:instrument/entries-v1` when
the seam was asked for `mode: 'entries'`, which numbers the module and each
function and nothing between — and every reader refuses a journal, record or
snapshot cut under the other.

**Worker journal.** Written by the setup file of a Vitest, Jest or Rstest
worker in its `afterAll`, one per test file, as `<pid>-<uuid>.va` under the
run directory `.run-<pid>-<uuid>` beside the coverage file. It is the one of the three that is
never built as those objects: the encoder walks the counter arrays the probes
increment and writes the ordinals out as the gaps between them, so a worker pays
one pass over each array and the reporter reads bytes.

```
journal  "VAJRN" | version | test file | modules | module | module | …
module   0 | id   or   1 | path | hits | shared | loaded
hits     count | gap | gap | …
```

Counts, ids and gaps are varints and text is a length and its UTF-8; ordinals
rise within a module, so a region costs one byte. A run of eight thousand test
files over two hundred thousand modules reports sixteen million module rows,
which is a gigabyte of text for the workers to render and the reporter to parse,
and a quarter of that as frames. No checksum: one process writes a journal and
closes it, one reader opens it once that process is gone, and the only damage
available to it is a tail that never arrived — which a decode obliged to land
exactly on the end of the frame refuses for nothing.

The reporter reads the record each id names, folds every journal's `hits` into
crossings and its `loaded` ordinals the same way over the other column, merges
into the coverage file, and removes the run directory. A
shared ordinal is credited to every test file that consumed the module; under
isolation each file consumed its own evaluation and the credit goes to nobody
else.

**Module record.** One module as bytes, appended by whoever transformed it to a
segment it alone holds open:

```
segment  "VAREC" | version | instrumentation id | frame | frame | …
frame    length  | FNV-1a of the payload | payload, padded to eight
payload  id 4 | flags 4 | blocks 4 | dictionary 4 | source digest 16 |
         dictionary strings, the module's path first, then one column per
         field: kind, owner, name, path, startLine, endLine, source bits, digest
```

The id is the module's number, or a reserved sentinel for a module transformed
before the table had one for it. Either way the path is the first string of the
dictionary, at a fixed offset from the start of the payload, so a reader places
a frame without decoding it: a scan for one module reads four bytes and, at
most, one string. The rest of the strings a
record uses — its block names, its block paths — are interned within the frame
and referenced by index; everything after them is a run of fixed-width
little-endian values at a computable offset, so a reader takes a slice where a
parser would take a pass. A module the parser refused has no blocks and says so
in its flags, which is what makes a consumer widen instead of trusting an empty
table.

A frame contains everything it needs, which is what lets a writer append and
return. A reader stops at the first frame that runs past the end of the file,
so a process killed mid-append loses that module and not the segment, and a
byte a filesystem lost silently fails the frame's own checksum rather than
arriving as a block table. A module transformed twice appends twice, and the
later frame is the one a reader takes.

On this repository's source, at 33.1 blocks per module, a record is 1,841 bytes
where the same record as JSON is 6,603. At two hundred thousand modules that is
351 MB in a handful of segments against 1,563 MB in two hundred thousand files,
and the JSON store's largest single document would not have been readable at
all: `readFile(…, 'utf8')` throws past 512 MB. That ceiling is why the source
index uses shared binary sections instead of one text document.

Nothing collects the records into a document and nothing has to: a transform
writes the module it just cut and knows nothing about the rest of the build,
which is what lets ten changed files out of two hundred thousand be rebuilt in
parallel, in any order, by processes that never meet, and lets the other
hundred and ninety nine thousand nine hundred and ninety keep firing probes
that still mean what they meant.

`label` separates two builds over one repository, a Storybook preview and the
application a Playwright suite drives, because an ordinal means something only
against the record that minted it. A driven run has nowhere else to read its
block table from, so a page journal's ordinals mean nothing without the store
the build wrote. When one run reads several stores, a module two of them store
with different source digests is recorded as not instrumented: its ordinals
mean two things.

**Page journal.** The collector that `testSelectionProbes` hoists in front of
every instrumented module installs the page factory and exposes itself on
`globalThis.__variance_authority_execution__` — the name `EXECUTION_GLOBAL`
spells — as `{ version: 1, instrumentation, drain(), reset() }`. `drain`
returns `{ instrumentation, modules }` and zeroes every counter; `reset` zeroes
without reporting. Call `drainExecution(page)` after each subject. You get
`undefined` back from a page with no collector, which means an application built
without probes and is not an error; handle it as its own case. Modules are keyed by the id the page reports,
which is the id the build instrumented them under.

**Journey account.** A **journey** is one execution of one subject, identified
by an opaque id the driver mints and sets on the browser context before the
first navigation. A **head** is a service process, instrumented by its own
build, that reads the id off the requests the browser sends and reports what it
entered under that id. [`journeys.md`](journeys.md) is their page. The type
`JourneyAccount` is what one head reports for one execution:

```json
{
  "version": 1,
  "instrumentation": "sense:instrument/presence-v4",
  "head": "api",
  "scope": "journey",
  "lost": 0,
  "modules": [ { "file": "src/routes/cart.js", "hits": [0, 1, 4], "shared": [0] } ]
}
```

`head` is the label the service's build instrumented under, so the driver
knows which store the ordinals index. `scope` is `journey` for crossings
made inside a request that carried a journey cookie and `process` for
everything the process did outside any journey, its own initialization for
instance, which the driver folds into every subject. `lost` counts the
earlier accounts this head could not deliver, and a positive count marks the
run incomplete. The account names neither the journey nor the subject: the id
travels on
the wire, and only the driver owns the map from journey to subject.

**The wire.** One execution is one opaque UUID minted by the driver, carried
in the cookie `variance-authority-journey`, and the address a head delivers
to is the cookie `variance-authority-return`, loopback `http` only. A head
reads
both off the request's `Cookie` header, runs the handler inside an
`AsyncLocalStorage` scope keyed by the journey, and when the scope settles
delivers the account as a JSON `POST` to `<return>/journeys`, three attempts,
or through the `__VAW__` sink function when the driver is in the same realm.
The head installs nothing unless `VARIANCE_AUTHORITY_JOURNEYS` is set, and
names itself from `VARIANCE_AUTHORITY_HEAD` when not told otherwise.
`stitchJourneys` joins every account bearing one id to the subject the driver
minted it for, counts an account under an id the driver never minted as
unclaimed, and marks the whole run incomplete when a declared head stayed
silent, reported another instrumentation id, or lost an account.

## Writing the record

Four ways bytes land in the file. Each is reachable from the imports above.

**Append from a worker run.** The Vitest, Jest and Rstest reporters read every
worker journal in the run directory, fold the `hits` and `loaded` columns into
crossings, merge into the coverage file and remove the run directory. O(sum of
journal sizes).

**Append from a driven run.** Call `recordExecution` with the drained subjects
in memory, one per owner, with the journey accounts already joined through
`joinObservations`. It reads from the store of the
build and of every declared head the record of each module the subjects
reported, refuses when it can identify none of them or when one names another
instrumentation id, and folds under `<coverage>.lock`. The lock is
exclusive-create, waited on for ten seconds at a 25 ms poll, and considered
stale after sixty. Two stores that disagree on one module's source digest
record it as not instrumented. A module missing from every store is dropped,
and the subject that entered it is recorded incomplete, because a subject whose
crossings cannot all be placed is one a later run may not skip. The fold is
O(hits) over every subject's journal plus O(modules reported) to build the
rows.

**Merge with the previous record.** `mergeCoverage` brings forward what the run
did not observe. When the instrumentation id differs the previous record is
dropped whole. A test the run observed replaces its previous row. A test the
run did not observe keeps its row, unless no region it crossed survives in the
new table, in which case it is demoted to incomplete and re-runs on its
next selection. An unobserved module whose text on disk changed has its rows
re-cut over that text, one parse per such module, and only a module whose text
cannot be parsed demotes every test that crossed it. Both sides are indexed
before the walk — modules by path, blocks by their address, name path and
structural path together — so the cost is O(M_prev + M_cur) plus
O(B_prev + B_cur) for each matched module, and the file is sorted on the way
out.

**Fold shards.** `foldTestCoverage` unions the records of a
sharded run, in any order, O(sum of shard sizes). It refuses shards with
differing instrumentation or commit, a test in two shards, and a module with
two source digests. An uninstrumented observation of a module wins over an
instrumented one, because a module that some shard could not instrument is
not evidenced by the shards that could.

**Encode.** `writeTestCoverage` sorts tests and modules by path, blocks by
ordinal, deduplicates preconditions and crossings, and builds one dictionary:
O(r log r) for `r` rows and strings. It writes under a scratch name and renames
into place, so a reader opening the path sees the previous snapshot or this one
and never the bytes between.

## What a reader refuses

Read a column and its values are checked on the way out; a column you never read
is never proven. Validation is paid for where it is used: a column nobody reads is never checked,
because nothing in it was believed. Shape is the exception — the section
index states it, and parsing the index is all an open does, so an open refuses
an index whose row counts disagree: a range column that is not one longer than the rows
it cuts, a column of block properties that does not agree with the block count,
a snapshot without exactly one instrumentation id.

Values are settled by the column that owns them, when something reads it, and
a run at a time where a run is enough to tell. Every string id is below the
dictionary size; every flag byte is zero or one; every kind byte names a kind;
every crossing names a test row; every block's start is at or before its end; a
module is instrumented exactly when it has blocks. A column nobody reads is
never proven, because nothing in it was believed.

Some properties are true of a whole column and of no run of it, and those are
settled when the column materializes: string offsets and the two range columns
start at zero and end at the length of what they cut; ordinals are unique within
a module; the first block of a module is the root, of kind `module`, with no
owner, and every other owner names an earlier block of the same module. Reading
such a column by the row goes straight through, on the bargain the crossings
already make — what a bad bound could do to a reader walking rows is refused by
the column the bound indexes, and a pair that runs backwards is a loop that does
not execute. `blocks.tests` has no check of its own for that reason: selection
reads two of its rows per region it asked about and never the column, and a
bound either lands in the crossings or is refused by them.

Any of those becomes an absent record rather than an empty one, so a corrupt
file costs you one full run and never a narrowed one.

## Complexity summary

| Operation | Cost | What pays it |
|---|---|---|
| instrument one module | O(length) | `instrument` |
| resolve the counter array | once per process that evaluates the module | the probe |
| record a hit | O(1) | the runtime counter |
| open the file | O(sections), no decode | `openCoverageFile` |
| one row of a column | O(run), decompressed once | a column read through the view |
| decode to the model | O(bytes) | `readTestCoverage` |
| module or test by path | O(log M), O(log T) decodes | a binary search of the path column |
| block by ordinal | O(B) | the module's block range |
| tests that crossed a block | O(crossings of the block) | the `blocks.set` range |
| tests governed by a file | O(P) | a walk of the precondition rows |
| diff to tests | O(diff + B per module + C charged + P) | `selectTestFiles` |
| graph walk, when a graph is supplied | O(n + m) per changed file | `selectTestFiles` with `options.relations` |
| blocks a test crossed | O(C) | the crossings column |
| tests covering a line | O(M + B²) | `coveringTests` |
| fold worker journals | O(journal bytes) | the reporter of a runner seam |
| read the names table | one read of at most eight immutable files | the transform, per build |
| a path's number | O(log M) per segment, then at most fifteen entries | the names table lookup |
| number what a run met | O(M log M), the compaction it publishes beside the delta | the fold, at the end of a run |
| record drained subjects | O(hits + modules reported) | `recordExecution` |
| merge with the previous record | O(M_prev + M_cur + Σ B) | `mergeCoverage` |
| re-cut an unobserved module's rows | O(module length) | `mergeCoverage`, per changed module |
| fold shards | O(Σ shard rows) | `foldTestCoverage` |
| encode | O(r log r) | `writeTestCoverage` |

**Further:** [`selecting.md`](selecting.md) for what a run does with the
answer · [`source-structures.md`](source-structures.md) for the static side ·
[`journeys.md`](journeys.md) for executions that cross processes.
