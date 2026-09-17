# Spec 0049 — the record answers a diff, and nobody can ask it about a place

**Missing:** the question surface. Every entry point over the execution record
takes a *diff* and returns a set to skip. The record physically holds the other
direction — region to tests, as its primary relation — and no command, no served
tool and, until now, no exported function let anyone stand on a line and ask who
goes there. One function with exactly the right name exists and reads a
different artifact: a JSON sidecar only Vitest writes, only under `cases: true`,
whose every crossing carries a depth of zero.
**Built on:** [0043](0043-a-record-costs-what-the-run-cost.md) (the record this
queries), [0045](0045-a-snapshot-states-its-own-age.md) (a point answer inherits
every integrity gap the file has),
[ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md) (why no
crossing carries a depth),
[ADR-0061](../context/adr/0061-a-crossing-relation-is-interned-not-owned.md)
(which direction of the relation is an address and which is a scan).

## Purpose

The feature was built for one caller: a runner that wants a shorter suite.
Everything about the surface follows from that and nothing about it survives the
caller changing.

Three questions make the point, and they are the ones people actually ask:

- *How many tests reach this file?*
- *Which tests enter this function?*
- *Which tests take this branch, and how far away are they?*

Nobody asking those is choosing what to run. They are:

- **About to change the line.** The number is a risk estimate before the edit,
  not a work list after it. Three tests is a change you make; six hundred is a
  change you stage.
- **About to delete the line.** A region with no crossings in a record that has
  seen the suite is either dead or untested, and which of the two is the next
  question. Coverage tools answer *was it run*; only this record answers *by
  whom*, which is what decides whether deleting it is safe.
- **Writing the missing test.** The answer names the tests that already go
  there, which is where the new one belongs.
- **Debugging a failure.** The failing test is known; what is not known is which
  *other* tests cross the same branch and will move with the fix.
- **An agent, holding a file and a line and no diff at all.** This is the
  common case now and the surface was not designed for it: the whole agent-facing
  vocabulary in this repository is about the visual report or a run in flight.

The gap is not in the storage. `moduleBlocks` cuts a module's regions out of the
region columns, `blockSet` names a pool entry per region, and
`crossings.members` decompresses one run of the pool — a binary search over a
sorted path column, one module's regions, one pool run per region. A point in a
200,000-module snapshot costs what a point in a small one costs, and
[ADR-0061](../context/adr/0061-a-crossing-relation-is-interned-not-owned.md)
says so on purpose.

The gap is that the question was never asked. What shipped:

- Every file-taking entry point in `packages/sense/src/test-selection/index.ts`
  either takes a diff — `selectTestFiles`, `narrowByExecution`,
  `distanceByExecution` — or decodes the whole model.
- `coveringTests` and `coveringTestsInFile`
  (`packages/sense/src/test-selection/reverse.ts:69`, `:85`) ask exactly the
  three questions above, over an `ExecutionIndex` a caller supplies. The only
  producer is `executionIndexFrom`
  (`packages/sense/src/test-selection/cases.ts:194`), written by the Vitest
  reporter beside the snapshot when `cases: true`
  (`packages/sense/src/test-selection/vitest.ts:351`). Jest writes none. Its
  `find` over `index.modules` is a linear scan of a decoded JSON model, so the
  cost is the repository's rather than the point's. And every crossing in it
  carries `distance: 0` (`cases.ts:279`), which
  [ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md) requires
  and which makes the tool's own "ranked by observed call-stack depth"
  (`packages/mcp/src/tools/source-tests.ts:13`) a promise about a number nothing
  measured.
- `variance_source_tests` is a working tool in a defined served set
  (`packages/mcp/src/tools.ts:116`, `packages/mcp/src/protocol.ts:65`) that **no
  binary serves**. `variance serve` serves the report set;
  `packages/mcp/src/bin.ts` offers a report path or `--watch`. `variance ask`
  derives its entire question list from the report and live-run sets
  (`packages/cli/src/commands/asking.ts:67-68`), so `variance ask source-tests`
  does not exist.
- `variance select` takes `--since` and `--format` and nothing else, and
  `packages/cli/src/select-args.ts:25` refuses a positional, so it cannot be
  pointed at a file.

`packages/sense/src/test-selection/at-source.ts` now answers the first two
questions over the snapshot itself, exported as `testsReaching`. That is the
floor this spec builds on, not its discharge: the answer names test *files*,
nothing user-facing calls it, and the third question is only half answered.

## What would discharge it

**1. A named test, from a record every runner writes.** The snapshot's test
table is keyed by path, so `testsReaching` answers at the granularity of a test
file and no finer. Names live only in the cases sidecar, which is Vitest-only,
opt-in, JSON, and scanned linearly.

Either the case axis enters the snapshot, with the size it costs measured and
published the way every other axis of this file has been, or the sidecar becomes
a real artifact: written by both runners, addressed rather than scanned, and
carrying the identity the snapshot joins on. Until one of those,
"which tests" has two answers at two granularities from two files, and a caller
has to know which one it is holding.

**2. One surface, reachable without a diff.** A command — `variance who <file>`,
`--line`, `--function`, `--branch` — and the served tool set that already exists
wired into a binary. Both read the same function, or they answer differently
within a release.

The served half is the smaller half and it is the one that matters most: the
question is asked by agents far more often than by hands, `SOURCE_TESTS` is
declared and tested, and what is missing is a mode on
`packages/mcp/src/bin.ts` and a subject to open.

**3. The distance question gets its honest half and refuses the other.** *Within
five hops* is two different distances and only one of them exists here.

- **Import hops** are real, measured, and already implemented in
  `packages/sense/src/test-selection/distance.ts`. `distanceToSource` composes
  them onto a point answer. But the walk needs, per test, every module that test
  entered — the direction the pool does not index — so it costs a pass over
  every region in the snapshot however narrow the point is. That cost is stated
  and paid in a separate entry point, and it is the honest shape until something
  indexes the other direction.
- **Call-stack depth** is foreclosed by
  [ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md) and is the
  number a caller asking "how far is this test from this branch" usually means.
  The tool description that promises it is corrected rather than the number
  invented.

**4. The three absences are told apart.** A point with no tests is *this file
was never recorded*, *this build never read it*, *the snapshot has no region at
this line*, or *nothing ran it*. `at-source.ts` separates all four, and the
surfaces above have to keep them separate — an empty list that means four things
is how a reader concludes the code is dead.

**5. The answer says what it is a reading of.** A point answer is taken from a
snapshot with a commit on it, and the lines a caller is pointing at are lines in
the working tree. `select.ts` has `sourceAt` for exactly this and a point query
has nothing: a file edited since the recording returns the audience of whatever
used to be on that line, and nothing says so. The same frame check, or the
answer carries the recorded commit and the caller is told to check.

**6. The question family is answered from one place.** The three above are the
near neighbours of a wider set that all read the same columns and none of which
has a caller:

- *Which regions of this file did nothing enter?* — the dead-code question, and
  `blockSet` naming the empty set answers it directly.
- *Which tests enter this file and nothing else under this directory?* — who
  owns a unit.
- *What else does this test's crossing set contain?* — a test's blast radius,
  which is `blocksCrossedBy`
  (`packages/sense/src/test-selection/crossing-sets.ts:576`), built, unexported
  and unused.
- *Which two tests cross exactly the same regions?* — redundancy in a suite,
  which is a set-identity comparison the pool makes free: two regions with the
  same `SetId` have the same audience by construction.
- *Which region has the largest audience?* — the hub, which `docs/distance.md`
  raises and nothing answers from a record.

Each is a few lines against the same columns. What they are missing is the
same thing the first three were missing, and a surface that admits one of them
and not the others will be extended by copy.

**Acceptance:** one command and one served tool, over the snapshot rather than
the sidecar, answering *which tests reach this file*, *which enter this
function* and *which take this branch* for a point in a 200,000-module fixture,
under `/usr/bin/time -l`, with a peak that does not move when the fixture grows
and a wall clock in milliseconds. Then the same three with hop distance, whose
cost is reported separately and is allowed to be a pass over the file. Then a
test that edits the file after recording and asserts the answer says the frame
moved rather than answering from stale lines.

## What it forecloses

**A point is not a one-line diff.** `blocksAround` charges outwards from a line
onto the regions around it, which is correct for deciding what to run and wrong
for saying who goes somewhere: it returns every test that rendered the component
and never took the branch, with nothing in the result to tell them apart.
Selection over-includes on purpose. An answer may not.

**No number is invented to rank an answer.** A depth nothing measured would sort
the answer by nothing, and a hop count with no graph is `unmeasured` rather than
zero. Where a distance cannot be had, the field is absent and the reader is told
why.

**A capability nobody can reach is not shipped.** A working query behind a
served set no binary opens is the state this spec exists to end, and it may not
be discharged by adding a second one.

**The sidecar does not become the answer.** A per-case JSON file one runner
writes when asked is evidence, not the record. Anything that makes the ordinary
answer depend on it has moved the feature behind an opt-in flag.
