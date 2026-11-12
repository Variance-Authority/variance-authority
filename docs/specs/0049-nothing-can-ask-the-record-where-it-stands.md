# Spec 0049 — a point answer costs the point, not the repository

**Missing:** an addressed point answer, a branch asked by its path, and the
questions beside them. `variance covering` finds a module by scanning the
decoded case index (`index.modules.find` in
`packages/sense/src/test-selection/reverse.ts`), so a point costs what the
repository costs, and no point has been measured on a 200,000-module fixture.
No command asks who takes a branch: `testsReaching` answers it by the branch's
path, and nothing calls it. No served tool asks any of them. A test's blast
radius (`blocksCrossedBy`, called only by its test) and two tests with the same
crossing set have no answer.
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

The answer does not use it. `variance covering` reads the case index, decoded
whole, and finds the module in it by a linear scan, so the cost is the
repository's rather than the point's.

## What would discharge it

**1. A point is addressed rather than scanned.** The named answer is read the
way the snapshot is: the module found by a binary search over a sorted path
column, and each of its regions' audiences read from one pool run. A point's
peak and wall clock then do not grow with the repository.

**2. A branch is asked by its path.** `variance covering` takes a file, a line
or a function. `testsReaching` in `packages/sense/src/test-selection/at-source.ts`
answers *who takes this branch* by the branch's path, and no command names one.

**3. A served tool asks it.** An agent holding a file and a line and no diff
asks this far more often than a hand does. The tool reads the function
`variance covering` reads, or the two answer differently within a release.

**4. The questions beside it are answered from the same columns.**

- *What else does this test's crossing set contain?* — a test's blast radius,
  which is `blocksCrossedBy`
  (`packages/sense/src/test-selection/crossing-sets-read.ts`), built and called
  only by its test.
- *Which two tests cross exactly the same regions?* — redundancy in a suite,
  which is a set-identity comparison the pool makes free: two regions with the
  same `SetId` have the same audience by construction.

Each is a few lines against the same columns, and a surface that admits one of
them and not the other will be extended by copy.

**Acceptance:** `variance covering` and one served tool answer *which tests
reach this file*, *which enter this function* and *which take this branch* for
a point in a 200,000-module fixture, under `/usr/bin/time -l`, with a peak that
does not move when the fixture grows and a wall clock in milliseconds.

## What it forecloses

**A line is answered as an edit to it is charged; a branch is answered exactly.**
A line that opens a branch holds the condition the region around it evaluates,
so the tests that evaluated it and never took the branch went to that line, and
an edit there selects them. A line point is therefore charged by the rule
selection charges a changed line by, `chargeLine`, and *who goes to this line*
never names fewer tests than a change to it runs. *Who takes this branch* is a
different question, and the branch path answers it with the branch's own
crossings and nothing around them. What a line point does not inherit is the
module fallback: a line no recorded region holds is unrecorded, not widened.

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
