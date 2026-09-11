# The execution record

This page is the reference for the structures on the execution side of test
selection: the blocks the instrument carves a module into, the coverage file
that remembers which test crossed which block, and the journals a run folds
into it. For each structure it states the primary key, how a row is found, how
a fact is traced back to the line or the test that produced it, and what a
lookup, a merge and an append cost. [`selecting.md`](selecting.md) says what a
run does with the answer; [`source-structures.md`](source-structures.md) covers
the static side that this page joins with.

Throughout, `T` is the number of tests the record holds, `M` the number of
modules, `B` the number of blocks in one module, `P` the total number of
preconditions, and `C` the number of crossings, one per test that executed a
block.
A head is a service process that reports what it ran, and a journey is one
execution followed across processes; [`journeys.md`](journeys.md) is their
page, and the last sections here give their shapes.

## The structures at a glance

| Structure | Primary key | Identity across runs | Lives |
|---|---|---|---|
| block | `(module path, ordinal)` | `kind`, `name`, `path`, own digest, owner chain | inventory, coverage |
| module | file path | file path with its source digest | inventory, coverage |
| test | test file path, or a story id | the same | coverage |
| precondition | `name` and `digest` together | the same pair | coverage, per test |
| crossing | `(block, test)` | the same pair | coverage |
| inventory | build label | the instrumentation id | beside the coverage file |
| worker journal | one test file in one worker | none, folded on read | the run directory |
| page journal | one drain of one page | none, folded on read | the driver's memory |
| journey account | one delivery from one head | none, stitched by journey id | the wire, then the driver's memory |
| journey | one minted id | the id | a cookie, and the driver's map to its subject |

## Blocks

`instrument` in `packages/sense/src/instrument/index.ts:77` parses one module
with `oxc` and returns `Instrumented`: the transformed `code`, the
`sourceDigest` of the exact input, the `instrumentation` id, and a `blocks`
array in ordinal order. `Block` in `packages/sense/src/instrument/blocks.ts:55`
carries the ordinal, the kind, the owner ordinal, the digest, the name, the
path, and the start and end offsets in the original source. A module the
parser cannot read returns `undefined` rather than an empty list, because *not
instrumented* and *no regions* are different facts.

**Kinds.** `module`, `function`, `branch`, `continuation`, `resume`, `loop`,
`case` and `handler`; the kind byte in the coverage file is the index into
that list. One rule generates the set: a block is a region that control
enters under exactly one condition, one the region around it does not imply.
Entering a `try` body follows from entering the region around it, so it is no
block; entering its `catch` does not, so it is.
Ternaries and the short-circuit operators stay inside the region that holds
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
each child region replaced by a `NUL`-framed `kind:name:path` placeholder. The
digest therefore changes when the block's own statements change and does not
change when a nested region's body does: the condition of an `if` belongs to
the region around it, and editing the condition moves that region's digest
while editing one arm moves only the arm's. A synthesized region, an `else`
nobody wrote or a `default` nobody wrote, has zero width and digests to its
kind alone.

**Offsets.** `start` and `end` are offsets into the original source. The
inventory and the coverage file carry lines instead, computed through the
bundler's source map when there was a transform before this one, so a diff
hunk lands on the file the author edited.

### A worked example

The first listing instruments to the second. Every insertion is on an
existing line; no line is added. The runtime header that the next section
describes is spliced at the end of the prologue, on line 3 here, and is left
out of the listing.

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

```js
import { tax } from './tax.js';

/* header */__va(0);export function total(items, premium) {__va(1);
  let sum = 0;
  for (const item of items) {__va(2);sum += item.price;}
  __va(3);if (premium) {__va(4);return sum * 0.9;} else{__va(5);}
  __va(6);return sum + tax(sum);
}

export const label = (n) => (__va(7),n > 0 ? `${n} items` : 'empty');
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
their placeholders, so an edit to `return sum * 0.9` moves block 4's digest
and leaves block 3's alone. The loop header `for (const item of items)` is
block 1's text, so editing it moves the function's entry digest.

Ordinals run on through the module: `label` is block 7 because seven blocks
were opened before its body, and a third function would take 8. `__va(7)` in
`label` and `__va(1)` in `total` index one array, the module's, so the file
has one counter array of eight slots, not one per function.

Across test files the ordinals are the join key. Every worker that ran this
module reports hits against the same eight slots, `crossingsOf` unions them
per ordinal into the block's `testFiles`, and `foldTestCoverage` unions the
records of a sharded run the same way, refusing two shards that hold the
module under two source digests, because their slot 4 would be two places.

### Ordinals under an edit

An ordinal is a slot in one instrumented version of a module. What survives an
edit is the identity above: `name`, `path`, `kind`, the block's own digest,
and the same four up the owner chain. `mergeCoverage` carries a crossing from
the previous record to the new one exactly when the block it was recorded
against still exists under that identity, and drops it otherwise. Two edits to
the example show the two outcomes.

**A function added inside `total`.** Inserting
`const price = (item) => item.price;` after `let sum = 0;` opens a new
function block, `total/price`, at ordinal 2, and every later block moves up
by one: the loop body is 3, `label` is 8. The module root keeps its digest,
because `total`'s body is a placeholder in the root's own text and the
placeholder did not change. `label` keeps its digest and its owner, so its
crossings carry over under the new ordinal. `total`'s entry digest moves,
because its own text now holds a new placeholder, and every block inside
`total` chains through that entry, so their crossings are dropped even where
their own digests did not move: the record no longer knows which arm of the
`if` a test reached under the function as it is now.

**A function added between `total` and `label`.** Inserting a top-level
`export function count(items) { return items.length; }` moves `label` to
ordinal 8 and leaves every digest but one unchanged. The one is the root's:
the declaration's header and its placeholder are new text at module level.
Every block in the module chains through the root, so every crossing in the
module is dropped, `label`'s and `total`'s alike, and each test that had
entered the module and was not part of the run that recorded the edit is
demoted to incomplete and selected whole on its next selection. The same
holds for any edit to module-level text: an added import, a renamed export, a
changed constant. A block's own crossings survive an edit only while nothing
above it changed, and the module root is above everything.

The table below is the merge of the original record, in which one test
crosses every block, into each edited module when that test does not re-run:

| edit | root digest | blocks that keep their crossings | the test's row |
|---|---|---|---|
| function added inside `total` | unchanged | root, `label` | incomplete |
| function added at module level | moved | none | incomplete |
| body of one `if` arm edited | unchanged | every block but that arm | incomplete |

### From a crossing back to a line

The record joins a block to the file two ways. `sourceDigest` on the module
row names the exact text the ordinals were cut from, and `startLine` and
`endLine` on each block are lines of that text. A diff is charged to lines, a
line lands on the blocks whose range holds it, and a block yields the tests
that crossed it; the procedure is in *Tracing a diff to tests* below.

Whether a change to a handler runs any test therefore depends on where the
edited line sits. Take a component whose render function holds a two-line
`toggle` closure and a one-line `onClick` arrow, recorded with one test that
clicked and one that only rendered:

| edited line | charged blocks | selected |
|---|---|---|
| a line inside `toggle`'s body | `Button/toggle` only | the test that clicked |
| the line `const toggle = () => {` | `Button/toggle`, then `Button` | both |
| the JSX line holding `onClick={() => …}` | `Button/anon#0`, then `Button` | both |

A line that is a region's first or last line is also the enclosing region's
text on that line, so the charge reaches outward and the tests that merely
rendered are selected. An edit that leaves a handler's own lines alone, or
lands on a line the handler holds entirely, charges the handler and nothing
wider, and a handler no test crossed then selects no test at all. A one-line
handler has no such line, so every edit to it runs the tests that reached the
component.

## The runtime contract

The transformed module carries three hoisted function declarations and one
statement, spliced at the end of the prologue. The prologue is the hashbang,
the directives, the imports, the re-exports, and every `vi.mock`, `vi.hoisted`
or `jest.mock` call, because a runner hoists those above everything and the
header must not land in front of them.

| Declaration | Role |
|---|---|
| `__va(i)` | resolve the counter array on first use or when the factory identity moved, then `c[i] = c[i] + 1 \| (r.e > 0 ? EVALUATING : 0)` |
| `__vaR(v, i)` | `__va(i)` and return `v`: the probe for an expression whose value must survive |
| `__vaE()` | lower the factory's evaluating depth by one, spliced after the last top-level statement |
| `__va(0); __va.r.e += 1; __va.c[0] \|= EVALUATING` | the module's own probe, and the raise that marks everything the top level calls as shared |

The one thing the module asks of its realm is `globalThis.__VA__`, a factory
`(file: string, count: number) => Uint32Array` with one mutable property `e`,
the evaluating depth. `file` is the id the module was instrumented under, the
repository-relative path in every shipped seam, and `count` is the number of
blocks, so a factory can refuse or replace an array whose length no longer
matches. A module with no factory throws at its first probe.
Three factories ship, and each is a different answer to *who was executing*:

| Realm | Factory | Keyed by |
|---|---|---|
| a Vitest or Jest worker | the setup file installed by `withTestSelection` | the module id; the worker's journal is written per test file |
| a page | the collector hoisted by `testSelectionProbes` | the module id; a driver drains between subjects |
| a service | the getter installed by `collectJourneys` | the journey in async context, one factory per journey |

A probe re-resolves its counter array whenever the factory identity changes,
and the emitted code is the same in all three realms. A worker that
shares one module graph across test files installs a factory per file; a
service that hands back a distinct factory per journey makes two interleaved
requests count into two arrays with no change to the probe.

**Probe forms.** Every insertion is text at an offset in the original, and no
inserted text contains a newline. A region whose body is a block gets
`__va(n);` after its `{`. A bare statement body is wrapped in `{` and `}`,
which is also what keeps a synthesized `else` from rebinding to an inner `if`.
An expression-bodied arrow becomes `(__va(n), expr)`. An `await` is wrapped as
`__vaR(await x, n)` so the resumed value reaches whoever wanted it. A missing
`else` is appended as ` else{__va(n);}` and a missing `default` as
`default:__va(n);` before the closing brace of the `switch`. The statement
after a decision gets `__va(n);` in front of it: that is the continuation, the
region whose arrival does not follow from the region above because an arm may
have returned.

**Identity.** `INSTRUMENTATION_ID` at `packages/sense/src/instrument/index.ts`
is `sense:instrument/presence-v3`. Every inventory, journal, account and
coverage file names it, and every reader refuses one that names another. A
change to where probes go or what a block means mints a new id.

**Cost.** One parse and one walk, O(module length). Instrumenting is done per
module per process that bundles, and the runtime records a hit in O(1): one
array read, one write, no allocation after the first resolution.

## The coverage file

The persisted record is one binary file. `VERSION` at
`packages/sense/src/test-selection/format.ts:11` is the number a reader
accepts, and a file with another version is refused rather than reinterpreted.
The container is a `u32` little-endian header length, a JSON header
`{ version, sections }` padded with `NUL` so the payload starts on an 8-byte
boundary, and then the sections. Each entry in `sections` carries `name`,
`offset` from the start of the payload, `length` in bytes and `width`, one
byte for `strings.blob` and the flag and kind columns, four for everything
else. Every section starts on an 8-byte boundary.

Every section is a column, and the columns of one group are indexed by the
same row number. A
column whose name ends in `.off` or is described as a range is a compressed
sparse row offset column with one more entry than the parent has rows: child
rows for parent `i` are `[off[i], off[i + 1])`.

| Group | Column | Holds |
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
| blocks | `blocks.tests` | range into the crossings |
| crossings | `crossings.test` | the test row that executed the block |

The logical model a caller sees is `TestCoverage` in
`packages/sense/src/test-selection/index.ts:98`: tests with their
preconditions, modules with their blocks, and on each block the test files
that crossed it. `decodeTestCoverage` in
`packages/sense/src/test-selection/format.ts:183` rebuilds that model from the
columns in O(bytes). `openTestCoverage` at line 269 of the same file does not:
it parses the header, wraps each section as a typed-array view over the
buffer, validates the columns, and returns the view. A run reads through the
view because a selection touches a few modules and never needs the whole
model.

**Location.** `testCoverageFile` in
`packages/sense/src/test-selection/index.ts:148` places the file under
`<cache>/variance-authority/test-selection/<repository-digest>/coverage.bin`,
with `<cache>` from `XDG_CACHE_HOME` or `~/.cache`. Inventories of what a
bundler instrumented sit beside it as `modules-<label>.json`; the Jest seam
keeps its inventories under Jest's own `cacheDirectory` instead, one per
transform cache key, so a cached transform and the meaning of its ordinals are
one artifact under two names.

## Keys

**Test.** The owner of an observation: the test file's repository-relative
path under a Vitest, Jest or Playwright run, because the runner's unit of
scheduling is the file, and a story id under Storybook, because a story is
selected on its own. Two observations of one owner in one write are refused as
a duplicate.

**Module.** The module's repository-relative path, with `modules.source` as
the digest it must still have for its blocks to mean anything.

**Block, within a file.** `(module row, ordinal)`. Ordinals are unique within
a module and the first block is the module root.

**Block, across files.** `name`, `path`, `kind`, own digest, and the same
four for every block up the owner chain. `mergeCoverage` matches `name` and
`path` first, and `reusableBlock` in
`packages/sense/src/test-selection/merge.ts:321` then compares `kind` and
digest on the block and recurses through the owners. A block that fails it is
a different block, and the crossings recorded against the old one do not carry
over.

**Precondition.** The pair of path and digest, kept unique per test by the
concatenation `name`, `NUL`, `digest`. A test's preconditions are the files
its answer depended on that the instrument could not see inside: the test
file itself, configuration, fixtures, and modules that were loaded but not
instrumented.

**Crossing.** `(block, test)`. The record holds presence, not counts: a test
crossed a block or did not. Counts exist only in the runtime array and are
gone once the journal is written.

## Finding a row

`findModule` and `findTest` in
`packages/sense/src/test-selection/lookup.ts:14` and `:19` binary-search the sorted path
column, decoding one string per probe: O(log M) or O(log T) decodes. A
block by ordinal within a module is a linear scan of the module's block range,
O(B).

The tests that crossed a block are the rows `crossings.test[blocks.tests[b]
.. blocks.tests[b + 1])`, O(crossings of that block).

The tests a changed uninstrumented file governs come from `testsGovernedBy` at
`packages/sense/src/test-selection/lookup.ts:53`, which walks every
precondition row once, O(P), and returns the tests by row with the names that
matched. A file no precondition names is returned as unread, which is the
signal that the record does not know it.

The preconditions of a test are the rows `tests.preconditions[t] ..
tests.preconditions[t + 1]`, O(preconditions of that test).

## Tracing a diff to tests

`selectTestFilesFromView` at
`packages/sense/src/test-selection/select.ts:105` performs the trace one
changed file at a time.

1. **Diff to lines.** `changedLines` in
   `packages/sense/src/test-selection/diff-lines.ts:49` reads the old side of
   each hunk: context lines are not charged, a pure insertion charges the line
   before and the line after, deletions charge the removed lines, a renamed
   file is read under its old name, and a file with no hunks is charged
   whole. O(diff length).
2. **Lines to blocks.** For each charged line, `blocksAround` at
   `packages/sense/src/test-selection/select.ts:263` scans the module's blocks
   once, O(B). Every synthesized region containing the line is charged. Source
   regions containing it are grouped by span, and the narrowest group is
   charged whole. Each wider group is charged in turn as long as a region of
   the group just charged reaches outward, which means its text on that line
   sits beside the wider region's text. A region reaches outward when the line
   is its first line, except that the module root and a continuation never do,
   a function also does when the line is its last, and a resume does only when
   no region of another kind has its span. A line no source region contains
   charges every block of the module.
3. **Blocks to tests.** Each charged block's crossings, O(C of those blocks).
   A module with a row but no blocks, or with no row at all, answers through
   preconditions instead, O(P).
4. **Files the record cannot see.** When the caller hands in the relations
   graph, `answerByImporters` in
   `packages/sense/src/test-selection/importers.ts:80` is asked about every
   changed file, and answers only for one no probe can sit in: it walks the
   graph from the file to its importers along `asset` edges, the kind the
   source scan records for such a file, selects the tests that crossed or
   precondition on any importer it reaches, and, when something imports the
   file as an asset, also charges every file whose edges are unknown. O(n + m) on the graph per changed file.
5. **Unread.** A changed path that no module row, no precondition and no
   importer holds is reported as unread, and the caller runs everything.

The whole trace is O(diff length + B per changed module + C of charged blocks
+ P), and one graph walk more per changed file when a graph is supplied.

## Tracing a test to what it depends on

The other direction is one row read. A test's preconditions name the files
whose change must re-run it without any block being involved, and its
crossings are the inverse of `crossings.test`: the blocks whose crossing range
contains the test's row. The file holds no index in that direction, so listing
every block a test crossed is O(C) over the whole record. `ExecutionIndex` at
`packages/sense/src/test-selection/reverse.ts:32` is the same data in the
shape a collector or an editor integration supplies: each block lists the
tests that crossed it with the call-stack depth from the test to the block,
and `coveringTests` at line 55 of that file answers by line
or by function name in O(M) to find the module and O(B²) to keep only the
innermost regions of the line.

## Tracing a block to its place

A block row gives its module row, its ordinal, and its owner ordinal. The
owner chain is followed by finding the owner's row inside the module's block
range, O(B) per step, at most depth steps. `name` and `path` together read
as a location without the chain: the declaration and the structural position
inside it. `start` and `end` place the block on the lines of the source at
`modules.source`. When the file
on disk no longer hashes to that digest the lines are the record's, not the
disk's, and `digestsOnDisk` in
`packages/sense/src/test-selection/merge.ts:269` is what notices.

## Journals

Every runner seam records what one process saw as JSON and leaves the fold to
the writer. Three journal shapes exist, and each carries a list of
`ExecutedModule`; the inventory that gives their ordinals meaning is the
fourth shape here:

```json
{ "file": "src/cart.js", "hits": [0, 1, 2, 3, 5, 6], "shared": [0] }
```

`file` is the id the module was instrumented under, `hits` the ordinals whose
counter was above zero, ascending, and `shared` the subset of `hits` whose
counter carried the `EVALUATING` bit. Presence only: the counts never leave
the process.

**Worker journal.** Written by the setup file of a Vitest or Jest worker in
its `afterAll`, one per test file, as `<pid>-<uuid>.json` under the run
directory `.run-<pid>-<uuid>` beside the coverage file. The shape is
`{ testFile, modules }` with `testFile` an absolute path and each module's
`file` the id the transform saw: an absolute path under Vitest, `<absolute
path>?<cache key>` under Jest. The reporter re-keys both to repository paths,
folds every journal through `crossingsOf` in
`packages/sense/src/test-selection/instrumented-modules.ts:200`, merges into
the coverage file, and removes the run directory. A shared ordinal is credited
to every test file that consumed the module; under isolation each file
consumed its own evaluation and the credit reaches nobody else.

**Inventory.** `InstrumentedModules` in
`packages/sense/src/test-selection/instrumented-modules.ts:36`, written by the
process that ran the bundler as `modules-<label>.json` beside the coverage
file, atomically through a rename, and rewritten as a dev server keeps
transforming:

```json
{
  "version": 1,
  "instrumentation": "sense:instrument/presence-v3",
  "modules": [
    {
      "file": "src/cart.js",
      "sourceDigest": "v1:8c27…",
      "instrumented": true,
      "blocks": [
        { "ordinal": 0, "kind": "module", "digest": "v1:8fe6…", "name": "", "path": "module",
          "startLine": 1, "endLine": 10, "source": true, "testFiles": [] },
        { "ordinal": 1, "kind": "function", "owner": 0, "digest": "v1:2540…", "name": "total",
          "path": "entry", "startLine": 3, "endLine": 8, "source": true, "testFiles": [] }
      ]
    }
  ]
}
```

Modules are sorted by `file` in code-unit order. A module the parser refused
has `instrumented: false` and no blocks. `label` separates two builds over one
repository, a Storybook preview and the application a Playwright suite drives,
because an ordinal means something only against the inventory that minted it.
It is the only place the block table for a driven run exists before the
coverage file, so a page journal's ordinals mean nothing without the inventory
written beside it. When one run reads several inventories, a file they hold
with two different source digests is recorded as not instrumented: its
ordinals mean two things.

**Page journal.** The collector that `testSelectionProbes` hoists in front of
every instrumented module installs the page factory and exposes itself on
`globalThis.__variance_authority_execution__`, the name `EXECUTION_GLOBAL`
carries, as `{ version: 1, instrumentation, drain(), reset() }`. `drain`
returns `{ instrumentation, modules }` and zeroes every counter; `reset`
zeroes without reporting. A driver calls `drainExecution` in
`packages/sense/src/test-selection/journal.ts:103` after each subject and
receives
`undefined` from a page with no collector, which is an application built
without probes and not an error. Modules are keyed by repository-relative
path, because the page reports whatever id it was instrumented under.

**Journey account.** `JourneyAccount` in
`packages/sense/src/test-selection/stitch.ts:31` is what a service process
reports for one execution:

```json
{
  "version": 1,
  "instrumentation": "sense:instrument/presence-v3",
  "head": "api",
  "scope": "journey",
  "lost": 0,
  "modules": [ { "file": "src/routes/cart.js", "hits": [0, 1, 4], "shared": [0] } ]
}
```

`head` is the label the service's build instrumented under, so the driver
knows which inventory the ordinals index. `scope` is `journey` for crossings
made inside a request that carried a journey cookie and `process` for
everything the process did outside any journey, its own initialization for
instance, which the driver folds into every subject. `lost` counts the
earlier accounts this head could not deliver, and a positive count marks the
run incomplete. The account carries no journey id and no subject name: the id
travels on
the wire, and only the driver holds the map from journey to subject.

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
`stitchJourneys` at line 118 of `stitch.ts` joins every account bearing one id
to the subject the driver minted it for, counts an account under an id the
driver never minted as unclaimed, and marks the whole run incomplete when a declared head stayed
silent, reported another instrumentation id, or lost an account.

## Writing the record

**Append from a worker run.** The Vitest and Jest reporters read every
worker journal in the run directory through `readJournals` at
`packages/sense/src/test-selection/vitest.ts:274` and
`jest-reporter.ts:213`, fold them through `crossingsOf`, merge into the
coverage file and remove the run directory. O(sum of journal sizes).

**Append from a driven run.** `recordExecution` in
`packages/sense/src/test-selection/journal.ts:191` takes the drained subjects
in memory, one per owner with the journey accounts already joined through
`joinObservations` at line 385 of the same file, reads the inventory of the
build and of every declared head from the cache, refuses when one is missing
or names another instrumentation id, and folds under `<coverage>.lock`. The
lock is exclusive-create, waited on for ten seconds at a 25 ms poll, and
considered stale after sixty. Two inventories that hold one file under two
source digests record it as not instrumented. The fold is O(hits) over every
subject's journal plus O(inventory) to build the rows.

**Merge with the previous record.** `mergeCoverage` at
`packages/sense/src/test-selection/merge.ts:183` carries forward what the run
did not observe. When the instrumentation id differs the previous record is
dropped whole. A test the run observed replaces its previous row. A test the
run did not observe keeps its row, unless a block it crossed is no longer
reusable, in which case it is demoted to incomplete and re-runs on its next
selection. A carried module whose digest on disk moved demotes every test that
crossed it. The cost is O(M_prev · M_cur) for the module match and O(B²) per
matched module for the block match by name and path, and the file is sorted
on the way out.

**Fold shards.** `foldTestCoverage` at
`packages/sense/src/test-selection/merge.ts:57` unions the records of a
sharded run, in any order, O(sum of shard sizes). It refuses shards with
differing instrumentation or commit, a test in two shards, and a module with
two source digests. An uninstrumented observation of a module wins over an
instrumented one, because a module that some shard could not instrument is
not evidenced by the shards that could.

**Encode.** `encodeTestCoverage` at
`packages/sense/src/test-selection/format.ts:53` sorts tests and modules by
path, blocks by ordinal, and deduplicates preconditions and crossings, then
builds one dictionary: O(r log r) for `r` rows and strings. Writers produce
the file under a scratch name and rename it into place.

## What a reader refuses

`validateCoverageColumns` at
`packages/sense/src/test-selection/format-validation.ts:31` runs on open and
throws on the first violation. String offsets start at zero, end at the blob
length, and never decrease; every range column does the same against its
child count; every string id is below the dictionary size; every flag byte is
zero or one; every kind byte names a kind; every crossing names a test row;
every block's start is at or before its end; a module is instrumented exactly
when it has blocks; ordinals are unique within a module; the first block of a
module is the root, of kind `module`, with no owner; and every other owner
names an earlier block of the same module. `existingCoverage` at
`packages/sense/src/test-selection/merge.ts:305` turns any of those into an
absent record, so a corrupt file costs one full run.
Validation is O(rows) once per open.

## Complexity summary

| Operation | Cost | Where |
|---|---|---|
| instrument one module | O(length) | `instrument` |
| resolve the counter array | once per factory identity | `__va` |
| record a hit | O(1) | the runtime counter |
| open the file | O(rows) validation, no decode | `openTestCoverage` |
| decode to the model | O(bytes) | `decodeTestCoverage` |
| module or test by path | O(log M), O(log T) decodes | `findModule`, `findTest` |
| block by ordinal | O(B) | the module's block range |
| tests that crossed a block | O(crossings of the block) | `blocks.tests` |
| tests governed by a file | O(P) | `testsGovernedBy` |
| diff to tests | O(diff + B per module + C charged + P) | `selectTestFilesFromView` |
| graph walk, when a graph is supplied | O(n + m) per changed file | `answerByImporters` |
| blocks a test crossed | O(C) | the crossings column |
| tests covering a line | O(M + B²) | `coveringTests` |
| fold worker journals | O(journal bytes) | `readJournals`, `crossingsOf` |
| record drained subjects | O(hits + inventory) | `recordExecution` |
| merge with the previous record | O(M_prev · M_cur + Σ B²) | `mergeCoverage` |
| fold shards | O(Σ shard rows) | `foldTestCoverage` |
| encode | O(r log r) | `encodeTestCoverage` |

**Further:** [`selecting.md`](selecting.md) for what a run does with the
answer · [`source-structures.md`](source-structures.md) for the static side ·
[spec 0028](specs/0028-the-instrument.md) for the instrument ·
[spec 0029](specs/0029-what-a-run-remembers.md) for what a run remembers ·
[spec 0030](specs/0030-a-diff-lands-on-blocks.md) for how a diff lands on
blocks · [`journeys.md`](journeys.md) for executions that cross processes.
