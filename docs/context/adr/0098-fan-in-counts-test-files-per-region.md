# ADR-0098 — Fan-in counts test files per region, and gives no verdict

**Status:** accepted
**Date:** 2026-10-27

## Context

Selection answers, for one edit, which tests it sends. Asked of every file at
once, the same record answers how far an edit to each file would travel, and
both ends of that distribution are findings. A region one test file ran is one
deletion from running unobserved, and line coverage scores it the same as a
region forty ran. A file that sends half the suite to every edit is where
selection saves nothing and where unrelated failures block a change. Before
this, the reading existed only as the `witnesses.mjs` script of journal 0067,
a one-off over cases rather than test files.

## Decision

**`variance coverage --fan-in` counts, per region and per file, the test files
that called into it, and prints the distribution per suite kind and three
ordered lists. It names no threshold.**

1. **The unit is the test file of a suite.** A selection hands a runner test
   files, so a region's fan-in is the number of test files whose cases called
   into it. Two suites running one path are two test files. A test file counts
   once per region however many of its cases ran it.
2. **Called, not loaded, and load is not counted.** A region counts the way
   `calledRegions` counts it: a crossing made while the module evaluated is
   not a call. An edit also runs the test files that only loaded the file, so
   every count is a lower bound on what an edit selects, and `covering --file`
   names the loaders. Load is not counted here because block-level load
   (`ExecutionBlock.loaded`, which our vitest producer writes) names no case:
   counting it would take one import-graph walk per file, quadratic at corpus
   scale, and would skip the mock ownership selection applies. Counting what an
   edit selects, loaders included, is selection's charge rule run per region;
   it waits for load attributed per case (spec 0095).
3. **Median, not peak, measures the cost of being selected whole.** A
   selection runs every test file of a changed file. The busiest region of a
   wide file is almost always a hub function that every caller runs, so
   `entered − peak` is about zero everywhere. `entered − median` (nearest rank)
   is what an edit to a typical region of the file pays for the rest of it: what
   region-grain selection would save, and the most a split could, since each
   part of a split file still sends every test file that called into it.
4. **Percentiles by nearest rank.** `median`, `p90` and `max` are values that
   occur; nothing is interpolated.
5. **No threshold, no verdict (ADR-0081).** Too few and too many are the
   reader's. The text names ten files per list, largest first, ties in
   code-unit order; the JSON lists every file.
6. **The script is deleted.** `witnesses.mjs` is replaced by the command.

## Consequences

- `--fan-in` reads only the record: one pass over the crossings, no file graph.
- A file whose tests mostly import it without calling into it reads narrow
  here; `covering --file` shows the loaders.
