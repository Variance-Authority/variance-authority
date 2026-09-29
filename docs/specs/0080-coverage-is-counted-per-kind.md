# Spec 0080 — coverage is counted per kind, and a change in it is the regions that changed

**Missing:** items 4 and 6. `variance coverage` counts every declared suite
over the regions any suite loaded, prints the overlap by kind, compares each
suite with its mainline's published record or with `--against`, and prints the
parts that add up to each change, in text, markdown and JSON (`countCoverage`
and `coverageChange` in `packages/sense/src/test-selection/coverage-count.ts`,
the command in `packages/cli/src/commands/coverage.ts`). The files no suite
recorded are counted from the source index, within `--from`
(`packages/cli/src/commands/coverage-source.ts`). Nothing writes the markdown
to a job summary, and nothing keeps a trend.
**Built on:** [ADR-0081](../context/adr/0081-a-coverage-ratio-is-reported-never-read.md)
(what is counted, the join, and that nothing reads it back),
`declaredSuites` and `testCoverageFile` in
`packages/sense/src/test-selection/suites.ts` (which records exist, and of what
kind), `caseMotion` in `packages/sense/src/test-selection/case-motion.ts` (the
difference, region by region), `addressKey` in
`packages/sense/src/test-selection/merge-carry.ts` (the join),
`packages/cli/src/commands/covering-suites.ts` (a question asked of every
declared suite and grouped by kind), `packages/cli/src/commands/covering-motion.ts`
(where the base record comes from).

## Purpose

This project reports change, and a coverage number is useful for the same
reason: the number on its own says little, and what a reviewer needs is the
change on this pull request and the regions that caused it. A visual suite
falling from 30% to 15% is one of three things: a story stopped rendering a
component, a story file was deleted, or the code the other suites run grew. Only
the region counts separate them, and `caseMotion` already has them.

## What would discharge it

**1. `variance coverage` prints the ratio per suite, and the overlap by kind.**

```text
coverage at 7556a03a — 4,812 regions in 311 files the suites loaded
  any suite           4,330   90.0%
    unit      unit    3,368   70.0%   recorded at 7556a03a
    checkout  e2e     3,850   80.0%   recorded at 7556a03a
    stories   visual  1,444   30.0%   recorded at 63e1d779
  more than one kind  2,910
  one kind alone      1,420   unit 380 · e2e 960 · visual 80
  no suite              482
  ran only at load      117
not joined across suites: 12 regions
source: 338 files reached from the entry points of packages/apps/main
  before reach              4 files    212 lines     61 regions
  recorded by no suite      27 files   1,203 lines   388 regions
  total coverage for 4,391 of the 5,261 regions: 83.5%, 1.4% before reach
```

A declared suite with no record prints `unrecorded` in place of its numbers,
and the first line says the total leaves it out.

**2. `--against <record>` prints both commits, and each difference in regions.**
With no flag on a pull request, the base is the one `review` already reads: the
mainline's published record at the merge base.

```text
coverage at 7556a03a against 6a8293f4 — 4,812 regions (4,790 at base)
  any suite           4,310 -> 4,356   90.0% -> 90.5%
    unit      unit    3,353 -> 3,352   70.0% -> 69.7%   gained 4 · lost 9 · written 22, 4 run
    checkout  e2e     3,832 -> 3,900   80.0% -> 81.0%   gained 51 · lost 2 · written 22, 19 run
    stories   visual  1,437 ->   718   30.0% -> 14.9%   lost 716 · hidden 3
      src/stories/checkout.stories.jsx no longer runs 716 regions
```

For each suite, `gained − lost − hidden`, plus the written regions it runs, minus
the deleted regions it ran, is the change in the count: unit is
`4 − 9 + 4 = −1`. A test is added that
fails when the breakdown does not add up to the arrow. `thinned` changes no
ratio and is printed only in `--format json`.

**3. `--format json` has every count and every region.** The regions are the
ones `caseMotion` returns, grouped per suite, so a CI step can print its own
table without reading the text.

**4. `--format markdown` is the job-summary block.** `variance review
--format markdown` prints it under its own heading when the root config
declares suites. The GitHub Action writes it to `$GITHUB_STEP_SUMMARY`.

**5. It exits 0 whenever it could read the records.** It has no threshold. A
record it could not read is an operator error with the record's path, the same
refusal `covering` gives.

**6. The trend is kept by the history store.** A share keeps one copy per
branch, so it has no earlier mainline numbers to show. When a history service
is configured, `variance share` on a mainline appends one row per suite: commit,
suite, kind, run, not run, ran only at load. `variance coverage --history <n>`
prints the last `n` rows. With no history service configured, the command says
it has no trend to show and prints the rest.

## Decided

**Files no suite recorded are counted in regions, on a ratio of their own.** The
scan stores each JavaScript and TypeScript file's size on its parse: bytes,
lines of code, and the regions the instrument's walk cuts from it
(`packages/sense/native/src/source_size.rs`). A file in scope that no record
loaded adds those regions to a second ratio, *total coverage for X of the R
regions*, where the regions before reach count as run and their share of the run
is printed with it. The first ratio's denominator stays what the suites loaded, so
a region cut from a parse, which may not match the cut a real build makes, never
moves the numbers the change is decomposed into. Item 6 stores the first ratio's
counts.
