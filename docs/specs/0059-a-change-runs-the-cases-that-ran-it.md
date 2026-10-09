# Spec 0059 — a change runs the cases that ran it

**Missing:** a selection whose unit is the case. Every seam records which case
entered which region (`<coverage file>.cases.bin`), and `narrowByJourneys`
already reads that record. But it answers with test files, and so does
`yarn test:since`. A branch that five of two hundred cases walked runs all two
hundred. Nothing hands a runner the five.
**Built on:** `cases.ts` (the per-case record, scoped by async context),
`execution-select.ts` `narrowByJourneys` (the region-to-case join),
[ADR-0072](../context/adr/0072-a-change-is-read-before-it-is-charged.md) (the
regions a change is charged to).

## Purpose

Running only the affected tests is the reason to record coverage at all. A test
file is the unit CI shards on. It is not the unit a person or an agent waits
on in a local loop. The record already has the finer answer, and a file-grain
selection throws it away at the last step.

## What would discharge it

**1. The join answers cases.** A region charged by 0030 or by a reading selects the
cases whose crossings entered it. `ExecutionNarrowing` carries the cases for each
selected file, each with its `SelectionReason`. A file keeps the file-grain
answer when any of the following is true: the file itself changed, the file has
no case record, the file was charged whole (a `load` verdict, an import path),
or a charged region ran for the file rather than for a case: at collection time,
in a `beforeAll`, or while a module evaluated, whether or not a case was open
(see [A module evaluated inside a case](#a-module-evaluated-inside-a-case)).

**2. Code outside every case is credited to every case.** A region that ran at
collection time, in a `beforeAll`, or while a module evaluated ran for the file,
not for one case. So every case in the file depends on it. The record already
says so, two ways. One that ran at collection time or in a `beforeAll` sits in
the file's own frame, which credits it to every case of the file. One that ran
while a module evaluated is marked `loaded`, and the evaluation is credited to
no case: covering names every case of each file that loaded the module, through
the file graph. A case that enters the same region later, by a call, is
credited with that call as usual.
Charging either selects the whole file, never the first case that happened to
load it.

**3. Each runner's own public filter, and nothing of ours.** The selected cases
are passed through the filter the runner already documents:

| Runner | Filter |
|---|---|
| Vitest | `--testNamePattern` over the full name, anchored and escaped, one alternative per case |
| Playwright | `--test-list`, a file of `path › title` lines |
| Rstest | `--testNamePattern`, as for Vitest |

No runner is patched and no reporter skips cases by itself. A person can paste
the same command, and it runs the same cases.

**4. A name is not an identity, and a collision widens.** `ExecutionTest.name`
is not unique within a file. When two cases share a full name and only one of
them was selected, the filter runs both, and `--dry-run` says so. When a
runner's pattern cannot express the set, the whole file runs and the run says
why.

**5. `test:since` chooses the grain.** File grain stays the default for the
gate. `--cases` asks for cases. `yarn verify` never narrows below the file.

**Acceptance, as scenarios:**

- A change inside a branch that one case of a 200-case file enters runs that
  one case under each of the three runners.
- A change to a function that only a `beforeAll` calls runs the whole file.
- Two cases named `renders` in one file, one of them selected: both run, and
  the dry run names the collision.
- A test file changed in the diff runs whole.

## A module evaluated inside a case

Point 2 rests on the record keeping what ran while a module evaluated apart from
what a case called. Inline requires move the first of the two into a case.
The option belongs to the transform — React Native's Babel preset, SWC's `lazy`
— not to Jest, and it turns an import into a lazy `require`, so a module evaluates
inside the first case that reads one of its bindings. The module's top-level
code then runs inside that case, and so does whatever that code calls: a
higher-order function wrapping a component, or a factory building a selector. The cases after it read the cached exports.

The record does not follow the runner. What ran while a module evaluated is
`loaded` and belongs to the file. The case that evaluated the module keeps what
it entered afterwards, as it would had the file loaded the module before any
case. An inline run and an eager run of the same file record the same regions
with the same cases. `inline-requires.integration.test.ts` runs one fixture
both ways and compares the two records.

The terms the mechanism is written in:

- A **region** is a block the instrument numbered. Its **ordinal** is its number
  within its module; ordinal 0 is the module's **root**, its top level. Regions
  nest, so a line lies in its function's region and in the root.
- A **probe** is the call the instrument inserted at a region. It logs the
  region into the current **bucket**, the log a collector opens per case.
- A **segment** is the stretch between two bucket switches; the collector
  switches to a case's bucket after `beforeEach` and away when the body
  settles. A probe logs a region at most once per segment each way: with the
  **evaluating** bit, set while the bucket's evaluating depth is above zero, or
  without it.
- `e()` and `x()` raise and lower the evaluating depth. Every module's
  prologue calls `e()` and then logs its own root with the evaluating bit; its
  last statement calls `x()`.
- `lists()` is a bucket's read-out: per module, `hits` (every ordinal),
  `shared` (those entered evaluating) and `again` (those entered both ways).
- `g` is the probe's slow write into the log. A module's root reaches the log
  only through `g`. A **story tap**, the recorder behind a case's story, tapes
  every visit in order: it makes every probe hit reach `g`, so the log holds
  repeats, which the read-out drops. It is not part of the coverage record.

```ts
// src/with-logging.ts
export function withLogging(fn, label) {
  const prefix = `[${label}]`;                // line 2: runs once, as greet.ts evaluates
  return (name) => `${prefix} ${fn(name)}`;   // line 3: the arrow's body runs on every greeting
}
// src/greet.ts
function greet(name) { return `hi ${name}`; }
export const loudGreet = withLogging(greet, 'greet');
// test/greet.case.ts: `greets first` and `greets again` call loudGreet;
// `greets nobody` does not.
```

Under inline requires, `greets first` is where both modules evaluate:

```mermaid
sequenceDiagram
    autonumber
    participant K as collector
    participant C as case "greets first"
    participant G as greet.ts
    participant W as with-logging.ts
    participant L as the case's bucket
    participant R as frame reader
    participant X as the index

    K->>L: open the case's bucket and switch to it
    K->>C: run the body
    C->>G: reads loudGreet, so the lazy require evaluates greet.ts
    G->>L: e(), depth 1; greet.ts root logged evaluating
    G->>W: reads withLogging, so with-logging.ts evaluates
    W->>L: e(), depth 2; with-logging.ts root logged evaluating
    W->>L: x(), depth 1
    G->>W: withLogging(greet, 'greet')
    W->>L: withLogging logged evaluating
    G->>L: x(), depth 0
    C->>W: loudGreet('a') calls the arrow
    W->>L: with-logging.ts root logged again, plain; the arrow, plain
    W->>G: the arrow calls greet
    G->>L: greet.ts root logged again, plain; greet, plain
    K->>L: the body settles: close and read the bucket out
    L-->>R: a frame: per module, row 1, and row 2 if any ordinal went both ways
    Note over L,R: row 1: every ordinal; those entered evaluating are marked shared<br/>row 2: the ordinals also entered plain, none shared
    R->>X: shared ordinals mark their regions loaded and credit no case
    R->>X: every other ordinal credits greets first
    Note over X: after every case closed<br/>with-logging.ts root: loaded; greets first, greets again<br/>withLogging: loaded; no case<br/>the arrow: greets first, greets again
```

Under an eager load, the requires are hoisted, so both modules evaluate in the
file's own bucket before any case opens, one after the other rather than
nested. The case's bucket first meets them at steps 12 and 14, and the index
ends up the same. `greets again` reaches the arrow and `greet` the same way
from its own bucket, which is where the note's second case comes from.

Each part of this exists for one reason.

**A read-out keeps both ways of an ordinal.** The log holds a region once per
segment each way. A read-out that merged the two, one entry per region with the
evaluating bit or-ed in, would read a region a case entered both ways as
evaluating only, and the case would lose the crossing it made at step 12: the
first case charged less than the second for the same call. So the sort and the
compaction keep each way as its own entry, and `lists()` reports an ordinal
entered both ways in `again`.

**A probe logs its module's root first, once per way per segment.** Any probe,
before logging its own region, logs its module's root if the segment has not
logged it that way yet: a case that entered any of a module's regions entered
the module, and an edit to its top level is an edit that case ran. The arrow
belongs to `with-logging.ts`. At step 6 its root is logged evaluating, so it
goes to `loaded`. Without the plain entry at step 12, `greets first` would be
missing from the root region that `greets again` holds. The root keeps a flag
of its own, one bit per way, tested against the evaluating bit rather than the
bit the other regions test: a story tap zeroes that one to see every hit, and
the root would otherwise be logged on every hit.

**The frame carries `again` as a second row, not a new field.** A case frame's
row has `hits` and `shared`, and a case reader folds rows one at a time:
`shared` becomes the region's `loaded` flag, and the rest credits the case. A
second row for the same module, listing the `again` ordinals with nothing
shared, folds into the crossings an eager run writes. `case-fold.ts` and the
Rust `FoldVisitor` read it unchanged. The frame format keeps its version, and
recordings made before it still open.

**The story tap tells a visit from a root log.** The root logs above reach `g`
too, and the tap records whatever reaches `g`. The module's prologue writes its root through `g`, and that is a
visit to the top level. A probe also writes the root through `g` at step 12,
and nothing visited the top level there. So the tap counts a root write as
a visit only when it comes straight after `e()`. The coverage record is the same
with the tap or without it.

**A case that crossed nothing still writes a frame.** `greets nobody` entered
no region. Its frame lists no modules, but it names the case, so the index
knows the case ran. A case missing from the index is one nothing can select,
and absence never widens.

**What reads `loaded`.** `coveringTests` answers a line with one list: the
cases that called its regions, and then, through the file graph, every case
whose file loaded the module, marked `loaded`. Line 2 lies in two regions:
`withLogging`, which credits no case, and the module root, which credits
`greets first` and `greets again` through its plain entries. Those two are the
callers, and with the graph `greets nobody` joins them.
Without a graph the loaders are not named, and `ranWhileLoading` says the list
may be short. `coveringChange` splits the same answer per region into `tests`
and `passengers`; for a region that ran while loading, `passengers` is absent
without a graph.

Point 1 is where the selector this spec asks for widens to the whole file.
Under inline requires a case was open when a `loaded` region ran, so that
widening keys on `loaded`, not on "no case was open".

**What does not read `again`.** The file-grain union reads the log directly and
or-s both ways per region; it loses nothing, because the file is selected
either way. `journey.ts` reports a journey's `hits` and `shared` and drops
`again`. Whether a request that is first to evaluate a module loses its later
crossings there the same way is unmeasured.

## Out of scope

**Parameterized cases.** `it.each` cases have their names formatted before
they run. Each formatted name is recorded as its own case and is selected by
that name. Nothing reconstructs the table.

**Cases that overlap in time.** Concurrent cases are attributed through async
context. A continuation that outlives its case is the case the record refuses to
guess about, and interleaving tests stay unsupported.
