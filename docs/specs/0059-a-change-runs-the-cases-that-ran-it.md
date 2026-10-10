# Spec 0059 — a change runs the cases that ran it

**Missing:** the case as the unit everywhere a selection runs. Under Jest and
Vitest, `VARIANCE_AUTHORITY_GRAIN=case` skips the cases of a selected file that
entered none of the changed regions. Playwright and Rstest still run every
selected file whole. A file run in part is recorded incomplete, so the next
selection runs it whole. A selection that reads a stand runs its files whole.
A runner with no seam reads files alone from `variance select`.
**Built on:** `cases.ts` (the per-case record, scoped by async context),
`select-cases.ts` `casesToSkip` (the region-to-case join for a selection),
`case-cut.ts` (the cut, carried from the process that read the selection to its
workers), [ADR-0072](../context/adr/0072-a-change-is-read-before-it-is-charged.md)
(the regions a change is charged to).

## Purpose

Running only the affected tests is the reason to record coverage at all. A test
file is the unit CI shards on. It is not the unit a person or an agent waits
on in a local loop. The record already has the finer answer, and a file-grain
selection throws it away at the last step.

## What exists

**The join answers cases.** `selectSuite` with `grain: 'case'` reads the case
index the record carries and names, for each selected file, the cases that may
be skipped: the ones whose crossings entered none of the regions the selection
charged that file to. A file runs whole when any of these holds:

- a reason other than a region selected it: the file changed, a precondition,
  a reader, an import path;
- the case index does not hold the region the selection named;
- a charged region ran for the file rather than for a case: at collection
  time, in a `beforeAll`, or while a module evaluated, whether or not a case
  was open (see [A module evaluated inside a case](#a-module-evaluated-inside-a-case));
- no case of the file entered the region.

A case whose journey was cut short or not seen to end runs. So does a case
that shares its full name with a case that entered.

**Code outside every case is credited to every case.** A region that ran at
collection time, in a `beforeAll`, or while a module evaluated ran for the file,
not for one case. The record says so two ways. One that ran at collection time
or in a `beforeAll` sits in the file's own frame, which credits it to every case
of the file. One that ran while a module evaluated is marked `loaded`, and the
evaluation is credited to no case. A case that enters the same region later, by
a call, is credited with that call as usual. Charging either runs the whole
file, never the first case that happened to load it.

**The runner skips through its own task modes.** The process that read the
selection writes the cut to one file, keyed by absolute test path. Each worker
marks the named cases skipped after collecting the file and before running it:
Vitest in the case runner's `onCollected`, Jest in a circus `run_start` handler.
A case the file already skips, or leaves out under `only`, keeps its mode.
Nothing reaches argv, so the selection holds at any number of cases. The
stderr line counts the cut: `selected 2 of 3, skipping 3 cases in 2 of them`.

**The grain is chosen, and the gate keeps the file.** File grain is the
default. `VARIANCE_AUTHORITY_GRAIN=case` asks for cases, and any value other
than `file` or `case` fails the run. The verify waves set the file grain.

## What would discharge it

**1. A cut file reads whole again.** A file run in part records the cases it
ran and is marked incomplete, because the cases it skipped recorded nothing.
The next selection runs that file whole, so a loop of edits alternates a cut
run and a whole one. The record would keep the skipped cases' reach from the
run before, and a file whose every case is accounted for would read as complete.

**2. A stand is cut against its own diff.** A stand's tests are read against
the diff since that stand. The cut reads the journal's diff alone, so a
selection with stands runs its files whole. A commit between two runs leaves
every test the second one skipped standing at the first commit until one run
takes the suite to a single commit, so a loop that commits as it goes loses
the cut after its first commit.

**3. Playwright and Rstest cut.** Playwright through its test list, Rstest
through its runner's task modes, as Vitest does.

**4. A collision is reported.** When two cases share a full name and only one
of them was reached, both run. The selection's notes would name the
collision, so a person reading stderr sees why a case they expected skipped
ran.

**Acceptance, as scenarios:**

- A change inside a branch that one case of a 200-case file enters runs that
  one case under each of the four runners.
- An edit, a run, and a second edit to the same function cut the file both
  times.
- Two cases named `renders` in one file, one of them selected: both run, and
  stderr names the collision.

## A module evaluated inside a case

Inline requires belong to the transform (React Native's Babel preset, SWC's
`lazy`), not to Jest. The transform turns each import into a `require` that runs
where the binding is first read. So a module evaluates inside the first case
that reads it: its top level runs inside that case, and so does whatever the top
level calls, such as a higher-order function wrapping a component or a factory
building a selector. The cases after it read the cached exports.

The case index has to record such a run as it records the same file loaded
eagerly. Below, one fixture shows what the index gets wrong when it does not, and
the five parts that keep it right. `inline-requires.integration.test.ts` runs
the fixture both ways and asserts that the two record the same regions with the
same cases.

### The fixture

```ts
// src/with-logging.ts
export function withLogging(fn: (name: string) => string, label: string): (name: string) => string {
  const prefix = `[${label}]`;                // line 2: runs once, while greet.ts evaluates
  return (name) => `${prefix} ${fn(name)}`;   // line 3: runs on every greeting
}
```

```ts
// src/greet.ts
import { withLogging } from './with-logging';

function greet(name: string): string {
  return `hi ${name}`;
}

export const loudGreet = withLogging(greet, 'greet');
// The case this module evaluated in. The first case asserts it, so a run whose
// transform did not defer the import fails instead of passing vacuously.
export const evaluatedIn: string | undefined = expect.getState().currentTestName;
```

```ts
// test/greet.case.ts
import { evaluatedIn, loudGreet } from '../src/greet';

it('greets first', () => {
  expect(loudGreet('a')).toBe('[greet] hi a');
  expect(evaluatedIn).toBe('greets first');   // the inline run; the eager run expects undefined
});
it('greets again', () => {
  expect(loudGreet('b')).toBe('[greet] hi b');
});
it('greets nobody', () => {
  expect(true).toBe(true);
});
```

The comment above each block names the file and is not part of it, so line 1
is the first line of code. The instrument numbers a region for each function
and one for each module as a whole, and puts a **probe** at each: a call that
writes an entry into the current log. A case that enters any region of a module is also logged as entering the
module's region, because an edit to the top level is an edit that case ran. In
`with-logging.ts`:

| Region | Lines | Entered by |
|---|---|---|
| the module | 1–4 | evaluating the module, and every case that calls into it |
| `withLogging` | 1–4 | `greet.ts`'s top level, once, while `greet.ts` evaluates |
| the arrow | 3 | every `loudGreet` call |

Line 2 lies in two regions here, `withLogging` and the module, both spanning
lines 1–4, so a change to line 2 charges both and selects the cases credited in
either one.

The collector gives each case its own log, and switches to it after the case's
`beforeEach`. Each module's prologue raises an evaluating depth and its last
statement lowers it, so while any module's top level runs, every entry is
written with an **evaluating** bit. When the case closes, the collector reads
its log out into a **frame**, one row per module, and the index folds the
frames. An entry with the bit marks its region `loaded` and credits no case. An
entry without it credits the case. A `loaded` region can still credit cases
through their plain entries.

### What the index records

The cases each region credits. The middle column is the inline run without
parts 1 and 2 below. The file graph is the import graph between files, which
names the cases of every file that loaded a module.

| `with-logging.ts` region | eager | inline, without parts 1–2 | inline |
|---|---|---|---|
| the module, `loaded` | `greets first`, `greets again` | `greets again` | `greets first`, `greets again` |
| `withLogging`, `loaded` | none | none | none |
| the arrow | `greets first`, `greets again` | `greets first`, `greets again` | `greets first`, `greets again` |
| **a change to line 2, without the file graph** | `greets first`, `greets again` | **`greets again`** | `greets first`, `greets again` |

`greet.ts` has the same shape: without parts 1–2, its module region loses
`greets first` too.

So a change to `const prefix`, read without the file graph, names `greets
again` alone. Yet `greets first` made the same call, and evaluated the module as
well. Its entries in the module's region were all written while the module
evaluated, so they credit no case.

### What happens inside `greets first`

```mermaid
sequenceDiagram
    autonumber
    participant F as greets first
    participant S as greets again
    participant G as greet.ts
    participant W as with-logging.ts
    participant LF as log of greets first
    participant LS as log of greets again

    F->>G: reads loudGreet, so greet.ts evaluates
    G->>W: requires with-logging.ts, which evaluates
    W->>LF: the module, evaluating
    G->>W: its top level calls withLogging(greet, 'greet')
    W->>LF: withLogging, evaluating
    F->>W: loudGreet('a') runs the arrow, nothing is evaluating now
    W->>LF: the module, plain (part 1)
    W->>LF: the arrow, plain
    Note over LF: closed: the module is loaded and credits greets first through step 7 (parts 1 to 3)<br/>withLogging is loaded and credits nobody<br/>the arrow credits greets first
    S->>W: loudGreet('b') runs the arrow
    W->>LS: the module, plain
    W->>LS: the arrow, plain
    Note over LS: closed: the module and the arrow credit greets again
```

`greets again` gets step 10 for free: its log is new, so its first entry into
`with-logging.ts` is a first entry into the module too. `greets first` does
not. Its log already holds the module from step 3, and steps 7 and 8 land in the
same log.

Under an eager load, both modules evaluate in the file's own log before any case
opens. The first entry `greets first`'s log gets for `with-logging.ts` is the
plain one made when the case calls the arrow, and the index is the same.

### The five parts

**1. A probe logs its module's region once each way after every switch.**
Before logging its own region, a probe logs the module's region if it has not
logged it that way since the collector last switched logs. One way is with the
evaluating bit and the other without. That gives step 7. Without part 1, the
module's region is logged again only after a switch, which gives step 10 but not
step 7.

**2. The log keeps both entries for a region.** Sort and compaction keep a
region once each way. The read-out, `lists()`, reports a region entered both
ways in `again`. Without part 2, steps 3 and 7 merge into one entry with the
evaluating bit or-ed in, so the region reads as `loaded` only, and step 7 is
lost: the evaluation erases the call.

**3. The frame carries those regions as a second row of the module.** A frame
has a row per module, listing the regions entered in `hits` and those entered
while evaluating in `shared`; a third list, `loaded`, is empty in a case's
frame. The readers, `case-fold.ts` and the
Rust `FoldVisitor`, fold any number of rows per module: `shared` sets `loaded`,
and the rest credits the case. A second row listing the `again` regions, with
nothing shared, credits the case for step 7. No reader changed, the frame format
keeps its version, and older recordings still open.

**4. The story tap does not count step 7 as a visit.** The story tap is a
debugging recorder, not part of the coverage record: it tapes every probe hit in
order, as the visits a case made, and step 7 reaches it like any hit. Nothing visited the top level at step
7. The tap counts a module entry as a visit only when it comes straight after
the module's prologue raised the evaluating depth. The tap is also why part 1
keeps a flag of its own per way: the other regions' probes skip a region already
logged by testing a per-region bit the tap zeroes to see every hit, and with
that bit the module would be logged on every hit. `story-tap.test.ts` asserts
that the coverage record is the same with the tap or without it.

**5. A case that entered nothing writes a frame.** This one does not depend on
inline requires. `greets nobody` enters no region. Without its own frame it is
missing from the index, in both modes. The file graph names only cases the
index holds, so a change to line 2 would never name it, even with the graph.
Its frame now lists no modules but names the case and how it settled.

### What a change to line 2 selects

`coveringTests` answers with one list. First come the cases credited in the
line's regions: here the module's region, so `greets first` and `greets again`.
Then, through the file graph, come the cases of every file that loaded the
module, marked `loaded`, which adds `greets nobody`. Without a graph the second
part is missing, and `ranWhileLoading` says the list may be short.
`coveringChange` splits the same answer per region into `tests` and
`passengers`. For a region that ran while loading, `passengers` is absent
without a graph.

[What exists](#what-exists) names where the case selector widens to the
whole file. Under
inline requires a case was open when a `loaded` region ran, so that widening
keys on `loaded`, not on "no case was open".

### The other readers of `lists()`

Every reader of `lists()` outside the case frame reads step 7 as an eager load
does, or charges nothing finer than a file.

- **The file-grain union** (`recordExecution`, `crossing-fold.ts`) owes a
  `shared` region to every file that loaded the module, the evaluating file
  among them. A case that evaluates a module and calls into it selects its file
  under either load. `journal-cases.test.ts` asserts it for a page case.
- **The page drain** (`drain()` in `probes.ts`) carries `again` on
  `ExecutedModule`. `caseJournals` hands it to the case fold as the second row
  of part 3, which serves `@variance-authority/playwright-test`, the Storybook
  collector and a staged run. `enterModules` joins the windows of one case per
  way: a region is entered plainly when a window entered it outside an
  evaluation or listed it in `again`, and the joined `again` is `shared`
  intersected with what was entered plainly. A plain union of `hits` and
  `shared` reads a region that one window evaluated and another called as
  `loaded` only. `joinObservations` and `absorb` both join through it.
  `journal-cases.test.ts` and `execution.test.ts` in `playwright-test` read a
  case that evaluates the module in its own drain, and one that evaluated it in
  an earlier drain of the same case, as they read the eager load.
- **The journey stitch** (`journey.ts`, `stitch.ts`) gives a journey's `shared`
  regions to every subject of the head, as it gives the hits no journey held.
  A journey that evaluates a module is stitched as one that found it
  evaluated, and `journey-evaluation.test.ts` compares the two loads.
- **The part writer** (`journey-parts.ts`) writes a journey's log through
  `encodeLog`, `again` row included, and moves the journey's `shared` regions
  to the common frame, which the fold charges to every case the process
  served. `journey-parts.integration.test.ts` has a service evaluate a script
  in the first request that needs it and finds that request's case charged
  with its later call.

A stitched subject carries no `again`. Its own entry into a region that ran
while the module evaluated is in `shared`, so at case grain it reads as
`loaded`, under either load. File selection is unaffected.

## Out of scope

**Parameterized cases.** `it.each` cases have their names formatted before
they run. Each formatted name is recorded as its own case and is selected by
that name. Nothing reconstructs the table.

**Cases that depend on each other.** The cut reads each case's own reach. A
case that reads state an earlier case left, a memoized result or a variable
its `describe` shares, never entered the changed region and is skipped. The
case record cannot see such a dependency, and the file grain is the answer for
a file whose cases depend on their order.

**Cases that overlap in time.** Concurrent cases are attributed through async
context. A continuation that outlives its case is the case the record refuses to
guess about, and interleaving tests stay unsupported.
