# Spec 0100 — a case ends where it decides

**Missing:** which branch a case ends on, and which test line reached it. A
case is one `it` or `test`. Its record holds the **regions** it reached — a
region is a block the sense addon places: a function body or one arm of a
branch — as a set. Nothing reads which of those regions is the decision the
test is about, which other cases end on the same one, or which test line got
there. And `covering`, the command that lists the cases reaching a line, lists
every case the same way, whether the line is the decision a case ends on or
code it only passed through.
**Built on:** the probe log in `packages/sense/src/instrument/probe-log.cts`
(one log per **bucket** — a case, or the ambient bucket a test file's hooks
report to — in which a region's first entry marks when the bucket first reached
it); the per-case record of `packages/sense/src/test-selection/cases.ts` and
its frames in `journal-format.cts`; the blocks the sense addon places, each
with a declaration `name`, a structural `path` and a source offset
([ADR-0071](../context/adr/0071-the-block-walk-is-the-addons.md)); `covering`;
and test-composition, the per-case reading of footprint, pieces and residue
that ADR-0086 decides and pull request 274 is landing, together with the
per-region case count it uses to set structure apart.
**Narrows:** [ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md)
decision 1 — a journey records the places a case visited and never their order —
for the test-runner seams only, by
[ADR-0087](../context/adr/0087-a-case-records-the-test-line-that-reached-each-region.md).

## Purpose

A **journey** is a case's set of regions
([`test-stories.md`](../test-stories.md)). A **story** is the opt-in recording
of one test that adds the order, the counts and the printed lines, and pays for
every visit. Between the two is an order the probe log already holds. When a
bucket **closes**, at the end of its case, its log is folded into the record:
the close keeps the modules' rows in the order the case first touched them and
sorts each row's regions, and the fold in `cases.ts` then drops the module
order. What is left is the set.

That order has a shape. A case first walks the code most cases in its file
walk, then ends on code few or no other cases reach. Measured on `packages/core`
with a throwaway prototype that kept the order and cut it at every test line
(688 cases with a recording, 682 of them with code in their record):

- **The trunk comes first.** Regions that at least 80% of a file's cases reach
  make up 53% of what a case reaches, averaged over the cases. In
  `diff.test.ts` every case walks `normalize`, then the alias rules, then
  `renderableOnly`, in that order.
- **What only this case reaches comes last.** Cut each case's first-reach order
  into tenths and pool the tenths across cases. Regions no other case reaches
  are 0.1% of the first tenth and 2.4% of the last. Regions at most five cases
  reach go from 1.4% to 13.3%.
- **It lands on the last test line that adds code.** 190 cases reach a region
  no other case reaches. In 158 of them the first such region is reached on the
  last test line that adds code, and in 26 more on the line before.

The trunk is counted within a file because it describes what a file's cases
share before they part. The leaf below is counted over the suite, because a
region another file's case also ends on is not this case's alone.

The **leaf** of a case is the region in its footprint that the fewest cases of
the suite reach. Rarity is a count over every case in the record, the count
test-composition already keeps for structure, so the leaf is computed when the
record is read: no case knows it while it runs. In 368 of the 682 cases one
region is the rarest. That region is a candidate for the decision the test is
about; in these four it is the decision (a path such as `for#0/body/if#4/then`
reads: the `then` arm of the fifth `if` in the body of the first `for`):

| Case | Leaf |
|---|---|
| `publish.test.ts`: replaces when nobody can say, and says so | `publish.ts:169`, `decide` `for#0/body/if#4/then` |
| `publish.test.ts`: keeps a newer format, and a newer version replaces an older one in its slot | `publish.ts:152`, `decide` `for#0/body/if#1/then` |
| `publish.test.ts`: refuses a malformed entry before touching the line | `publish.ts:75`, `publishLine` `for#0/body/if#0/then` |
| `diff.test.ts`: rejects a cross-profile comparison outright | `diff/index.ts:103`, `diffSnapshots` `if#1/then` |

In the other 314, several regions are equally rare, in different functions in
209 of them. The leaf is then all of them, because no tie-break that was tried
picks the decision reliably (below).

In the field's terms the leaf is a *focal method*
([prior art](../context/prior-art.md#test-to-code-traceability)) found at the
grain of a branch, and found by rarity across the suite rather than by
nearness to an assertion. It is the dynamic form of *last call before assert*.
SCOTCH+, the stronger form of that signal, slices backward from each assertion
through the stack standing at it. The record holds no stack (ADR-0056), and a
story that could stand in for one pays for every visit. The leaf needs only the
set, and the line that reached each region to say where in the test it fell.
The field's finding still holds: no single signal is enough alone. The leaf
would be this project's first test-to-code signal, because nothing here links a
test to the code it asserts on yet. It is not combined with a second signal
here.

### Three things nothing reads today

All three come from the set and the suite-wide count. Test-composition answers
what a case adds over the narrower cases inside it; these answer where it ends.

- **Cases that share a leaf.** "Reports a prepend" and "reports a relabel" both
  end on `match.ts:168`. "Reports a reorder as movement" and "reports a
  rotation as movement" end on the same three equally rare regions, among them
  `compareTrees` `for#2/body/if#0/then`. Two cases with one leaf exercise one
  decision: either they are one test written twice, or what tells them apart is
  asserted on code both reach, and the reader decides which. Test-composition's
  *alike* is the stricter relation, an identical footprint.
- **A case whose leaf is another test's subject.** Three `diff.test.ts` cases
  about what a profile cannot see — "names geometry as unobserved under jsdom",
  "reports nothing unobserved under chromium except texture" and "narrows
  nothing under chromium" — share their leaf with "short-circuits on a
  render-hash hit": the render-hash check in `compareTrees` (`if#0/then`). They
  diff two identical builds, so no comparison runs, and what they assert is a
  fact about the profile.
- **Which cases a region is the leaf of.** Of the 3,193 regions the cases
  reach, 147 are reached by more than 100 cases each, and 439 by exactly one.
  An edit to a leaf changes the decision one case, or a few, ends on. An edit
  to the trunk is reached by most cases and is the leaf of none.

## What is recorded

The set gives the leaf. What the record lacks is the test line that reached
each region. With it, the leaf says where in the test the decision was reached,
and the test reads as a **cadence**: what each test line added to what the
case reached. That is a fact about every case, read by readers that walk every
case — `covering` and test-composition — so it is written into the record,
where ADR-0076 put the story beside it. A story for every case is the
alternative, and it pays for every visit; the line pays once per region.

The full first-reach order was measured as the alternative to lines and is not
recorded. It breaks every tie, by picking the region reached latest, at 58 KB,
about 10% of the 593,200-byte `coverage.bin`, against 3.8 KB, under 1%, for the
lines. But breaking a tie is not finding the decision. Where the order and the
line pick different regions, 109 cases, a clean-context agent shown only the
case and the two candidates, unlabelled and in random order, judged the
order's pick to be what the test is about in 34, the line's in 27, and neither
in 48. The order gains about seven correct leaves in 682 cases for fifteen
times the size, so a tie is reported as a tie.

A second run of the same suite gave the same rarest regions for all 682 cases,
so what the leaf reads does not move between green runs here. A case whose
async work interleaves differently on each run can reach a region from another
line; the line a region is charged to is then the one this run reached it from.

A **cut** is the log's length at the moment a test statement starts: one integer
per statement, with no snapshot taken and nothing read. A transform the seam
adds inserts the call before each statement of a test or hook body, and stops
at nested functions. A statement that fuses act and assertion,
`expect(diff(a, b)).toEqual(…)`, is one cut, and its regions are that one line's.
The close reads the log with its cuts before it sorts it, and charges each
region to the statement whose cut is the last one before the region's first
entry. The frame then stores a table of the lines of the statements that added
a region, and, for each region of the case, the index of its statement in that
table.

## What this narrows in ADR-0056

ADR-0056 records no order because of the wall it names: on a page, other
executions run between a function's entry and its resumption, so an order of
the page's crossings is somebody else's work interleaved with yours. A
test-runner seam runs one case at a time and logs per bucket, and the log is
already written in first-reach order. What this narrowing admits is one fact
per region of a case: the test statement that first reached it, per
test-runner seam. No rank within a statement, no counts, no repeats, no span,
no stack, no depth, and nothing written on a page. Selection reads none of it.
It is the first narrowing of ADR-0056 that writes into the record itself;
[ADR-0076](../context/adr/0076-a-story-is-the-order-one-case-visited.md) kept
the story beside it, and the reason this does not is the one above: its
readers walk every case.

## What would discharge it

1. **The leaf, read from the set.** No new recording and no ADR. The sense
   addon computes it from the per-region case count test-composition keeps.
   - `variance ask test-composition --file <test> --name <case>` names the
     case's leaf beside its residue: for each rarest region, the declaration,
     the structural path and the source line; then the other cases that share
     the leaf.
   - `covering --file --line` lists, for the region the line is charged to, the
     cases whose leaf it is before the cases that only reach it, and says which
     is which.
   Equally rare regions are listed in source order. A case whose record holds
   no region has no leaf, and the answer says the case reached no code rather
   than printing an empty leaf.
2. **Cuts per test line.** An ADR narrows ADR-0056 decision 1 as above. Under
   Vitest, Jest and Rstest, the seam's transform cuts the log before each
   statement of a test or hook body. Test files are not instrumented today
   ([spec 0097](0097-a-consumer-pays-for-what-it-loads.md)), so this is new
   work in each seam. The close charges each region to its statement and the
   frame stores the line table and the per-region index above. A hook's
   statements cut the log its crossings already go to, which
   [`cases.ts`](../../packages/sense/src/test-selection/cases.ts) makes the
   file's ambient bucket. The seam's options take `cadence: false` to leave
   test files uncut. The record lands first, with nothing reading it but the
   layer that carries it; the reader lands with item 1, whose leaf it is
   written beside. Test-composition's answer adds the test line that reached
   each rarest region, and lists equally rare regions by that line, latest
   first, as an order to read them in rather than a pick. A record written
   without cuts reads as *lines not recorded*, never as every region charged
   to one line.

## Acceptance

On this repository, after `yarn test:unit`:

1. `variance ask test-composition --file
   packages/core/src/share/publish.test.ts --name "replaces when nobody can
   say, and says so"` names `publish.ts:169`, `decide`
   `for#0/body/if#4/then`, and after item 2, that it was reached at
   `publish.test.ts:71`.
2. `covering --file packages/core/src/share/publish.ts --line 169` lists that
   case as the one whose leaf the region is, and lists every other case that
   reaches the region as reaching it.
3. In `diff.test.ts`, "reports a prepend…" and "reports a relabel…" are each
   named as sharing the other's leaf, and "reports a reorder…" and "reports a
   rotation…" as sharing one of three tied regions.
4. The three profile cases named above and "short-circuits on a render-hash
   hit" are each named as sharing the `compareTrees` `if#0/then` leaf.
5. After item 2, a `beforeEach` statement that adds a region in the file's
   first case is charged, with its line, in the ambient bucket and in no case's
   own record; a test body's statement is charged only in its own case.
6. Reading a record written before item 2 lands reports *lines not recorded*
   for every case, and the leaf is still named from the set, without a line.
7. The pull request that lands item 1 states, for MUI, how many cases have one
   rarest region. The pull request that lands item 2 states the size the cuts
   add to `coverage.bin` and the time they add to the suite, on this repository
   and on MUI. Neither may double what it adds to, and both are kept as small
   as the cuts allow.

## What it does not do

- **Narrow or reorder a selection.** A leaf orders the cases a reader is shown.
  Selection never drops a case because its leaf lies elsewhere, and never runs
  one first: a name pattern ([spec 0059](0059-a-change-runs-the-cases-that-ran-it.md))
  cannot reorder the cases in a file, and a case run earlier sees different
  module state. Ordering a run belongs with
  [spec 0098](0098-the-runner-is-handed-its-selection.md).
- **Break a tie.** Equally rare regions are all the leaf. The full first-reach
  order would pick one, and is not recorded (above).
- **Move a hook into its case.** A `beforeEach` and an `afterEach` stay in the
  ambient bucket, credited to every case in the file. Charging them to the case
  they ran for narrows what every other case in the file is credited with, so
  that is its own change against spec 0059.
- **Read interleaved cases.** The log is one case at a time, as the recording
  is. Two cases interleaving inside one module are not read apart.
- **Replace a story.** A cut charges each region's first reach to a line, with
  no counts, no repeats and nothing the code printed. A question about how often
  or what value is still a story's.
