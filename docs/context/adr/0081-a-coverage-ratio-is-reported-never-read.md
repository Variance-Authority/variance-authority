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
3. **What no suite recorded is counted apart, on a ratio of its own.** The
   source index lists every source file, and the scan stores each parse's
   size: bytes, lines of code, and the regions the instrument's walk cuts from
   it. A product source file that no suite recorded is listed with those
   counts, and its regions join a second ratio, *total coverage for X of the R
   regions*. They never join the first ratio's denominator,
   because a cut made from a parse may not match the cut a real build makes.
   Which files are in scope is `--from`'s: what a directory's declared
   `entrypoints` reach along the recorded imports, or every file under it when
   it declares none. Without `--from`, the source is what every declared
   directory's entry points reach together, and each directory gets a line of
   its own; a file no entry point reaches is not counted anywhere.
   `--packages` gives every workspace the root manifest names such a line,
   counted twice: over its own files, and over everything they import. With no
   entry point declared, it is every file the index holds. A monorepo measures
   each application apart, and a shared package an application imports is part
   of it. A file whose language stores no size is left out, never counted as
   empty. A module recorded with `instrumented: false` is counted as loaded
   and unread. What the harness loads is before reach: the files the
   preconditions every test in a record declares reach through their imports,
   walked by `beforeReach`, counted within each scope, so the runner's config,
   which no application imports, is in none. They ran under every test and have
   no region in any record. They are listed on their own line, their regions
   count as run in the second ratio, and the ratio says what share of the run
   they are: code the harness runs is tested by every test and aimed at by
   none, which is how most of a harness is tested. A module a seam loaded, chose not to
   instrument and the harness does not load is in no record and is listed with
   the files nothing loaded, so the report says *recorded*, never *loaded*.
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
- Two ratios are printed, and a reader has to know which one a number is. The
  one over the whole source counts what the harness loads as run, which no
  record shows, so its share of the run is printed with it. The one over what the suites loaded
  is the one the change is decomposed into.
- The scan now walks every JavaScript and TypeScript parse a second time to
  count its regions, and the source index grew three columns (format version
  14), so every existing index is rebuilt once.
