# ADR-0081 — a coverage ratio is reported with the regions that changed it, and nothing reads it back

**Status:** proposed
**Date:** 2026-09-28
**Amends:** [spec 0035](../../specs/0035-a-flake-is-what-the-run-did-not-execute.md)
— its *a footprint is not a coverage percentage*, which is narrowed to what
selection and attribution derive
**Relates to:** ADR-0002 (a suite with no record is unrecorded,
never 0%),
[ADR-0056](0056-a-journey-is-the-places-visited.md) (presence is the whole
record), [ADR-0069](0069-every-answer-has-an-owner.md) (carry, never recompute),
[ADR-0076](0076-a-suite-is-declared-and-records-alone.md) (a suite has a kind
and a record of its own),
[spec 0064](../../specs/0064-the-record-in-vs-code.md) (the host's union
percentage), [spec 0080](../../specs/0080-coverage-is-counted-per-kind.md)
(the reader this decision allows),
[`packages/sense/src/test-selection/suites.ts`](../../../packages/sense/src/test-selection/suites.ts),
[`packages/cli/src/commands/covering-suites.ts`](../../../packages/cli/src/commands/covering-suites.ts)

## Context

Spec 0035 says no threshold, ratio or score is derived from the execution
index, and spec 0028 is titled *the path, not the percentage*. Both protect
selection. A selector that reads a score excludes on a number that no region
backs, and a flake verdict that reads a footprint size has taken the count for
the path.

A team still asks a question that is a count: how much of the code each kind of
suite runs, how much only one kind runs, and how that changed on this pull
request. The record can already answer it. Since ADR-0076, every declared suite
records alone and has a kind. Every module a suite loaded lists all of its
regions, the ones nothing ran as well as the ones something did, and each region
lists the test files that ran it. The ratio is a count over lists the record
already has, and today every team computes it with Istanbul, a second
instrument and a second run.

Spec 0035's sentence forbids the count everywhere, which is wider than the
reason behind it. The reason is about readers that decide. A report decides
nothing.

## Decision

**A coverage ratio is a reported reading of the record, per suite kind, and no
selector, verdict or exit code reads it.**

1. **The unit is the region, and a region counts as run when a case called
   into it.** This is the rule `caseMotion` already counts by: a region
   entered only while its module evaluated was entered by whichever case
   imported it first, and says nothing about a test. Those regions are counted
   on a line of their own, *ran only at load*. A region with no source of its
   own (`source: false`) is not counted. Lines are a second reading of the same
   count, through the lines each region was written on, and a region with no
   written lines has no lines to count.
2. **The denominator is what the suites loaded.** It is every counted region in
   every module a declared suite recorded. A suite's own ratio uses the same
   denominator as the total, so *visual 30%* is 30% of the code any suite
   loaded, not of the code the visual suite loaded.
3. **What no suite loaded is counted apart, in files.** The source index lists
   every source file. A file no suite recorded has no regions, so it is
   reported as a number of files on its own line, and never folded into the
   ratio as regions nobody ran. A module recorded with `instrumented: false` is
   counted the same way, as loaded and unread.
4. **Regions are joined by address, across suites and across commits.** Two
   builds can cut one module differently, and an edit shifts a region down the
   file. The case index already names a region by address — name path and
   structural path, told apart by occurrence, and kind — and `caseMotion` joins
   two records by it (`addressKey` in `merge-carry.ts`). The ratio uses the
   same join and no second one. A region one suite recorded and no other
   suite's cut matches is counted under its own suite, and the report says how
   many regions did not join.
5. **Overlap and solitary are counted by kind, not by suite.** For each region,
   the reading takes the set of kinds whose suites ran it. *More than one kind*
   is a set larger than one. *One kind alone* is a set of exactly one, with a
   count for each kind. Two `e2e` suites that ran one region are one kind.
6. **A change in the ratio is reported as the regions that changed.** Against a
   base record — the one `covering --against` and `review` already read, the
   mainline's published record on a pull request — the ratio is printed at both
   commits, and the difference is decomposed per suite into `caseMotion`'s
   counts: `gained`, `lost`, `hidden`, `thinned`, plus the regions the edit
   wrote and deleted, which change the denominator and are not motion. The
   decomposition adds up to the difference, and the test files whose reach
   changed (`CaseMotion.testFiles`) are named under it. A ratio that fell with
   no region lost is a denominator that grew, and the report says which.
7. **Absent is not empty.** A declared suite with no record is printed as
   unrecorded, and the total says it does not include that suite. A suite with
   no base record has no arrow, not an arrow from 0%. A repository that
   declares no suites has one record with no kind: the report prints its ratio
   and no overlap line.
8. **Nothing reads it back.** No selector, flake rung, verdict or exit code
   takes the ratio as input. The ratio is not written into the execution record
   either (ADR-0056: what is read off the record is never written back). A
   number that is kept for a trend is kept outside the record, by the store
   that keeps history.

## What this forecloses

- **A default threshold.** The command exits 0 when it could read the record,
  whatever the ratio is. A gate on the number is a line in the caller's CI.
- **Counting from a second instrument.** The ratio comes from the record
  selection reads, not from Istanbul or V8 coverage run beside it. The two
  would count different units, and the difference would be reported as a
  change in coverage.
- **Weighting by kind.** No kind counts for more than another in the total. A
  region is run or not run.
- **A ratio per test file.** A test file's share of a module is the deviation
  measure, which already exists and answers a different question.
- **A difference computed by subtracting two totals.** Two totals subtracted
  give a number no region backs. The difference is the motion, counted region
  by region, and the arrow is its sum.

## Cost

- Spec 0035's sentence becomes narrower, and it has to be read with this
  decision beside it.
- A total over suites recorded at different commits is a total over different
  texts. The report prints the commit each suite was recorded at.
- A region that ran only at load is not counted as run, so the ratio is lower
  than the line coverage Istanbul prints for the same run. The *ran only at
  load* line is the difference.
- The files no suite loaded are a count, not a ratio, until something cuts
  their regions without running them. Spec 0080 keeps that as its open
  decision.
