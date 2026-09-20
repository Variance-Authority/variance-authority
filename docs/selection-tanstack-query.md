# TanStack Query: 27 packages, 10 test files run

[TanStack Query](https://github.com/TanStack/query) is 27 packages, so a
package-grain selector already has something useful to say: change
`query-core` and it runs the 24 packages that depend on it. That is the correct
answer to the question a graph asks, and it is 168 of the 188 test files. Run
the suite once through [Variance Authority](README.md) and the record answers
the question you wanted asked — which tests entered the lines you changed —
with 10.

Nothing in the repository was written with this in mind and no test was changed
to accommodate it. One commit adds the instrumentation; the
[fork](https://github.com/Variance-Authority/tanstack-query-example) carries
it, along with the write-up and the scripts every figure below came from.

## The whole suite, once

| | |
| --- | --- |
| Test files | 188 |
| Tests | 4,523 |
| Wall clock | 14.1s |
| Modules recorded | 259 |
| Regions recorded | 5,409 |
| Record on disk | 332 KB |

The record is one file for the whole workspace. It has to be: a `react-query`
test entering `query-core` is the observation the whole thing rests on, and two
separate runs cannot see it.

## One line, asked of the record

Inside `Query.fetch` in `packages/query-core/src/query.ts`:

```diff
-      if (observer) {
+      if (observer !== undefined) {
```

Ten test files across five packages, 780 tests, 2.8s against the suite's 12.0s.
The graph runs 168, because every test in an invalidated project belongs to an
invalidated project. Both answers are defensible; one of them is 16.8 times the
other.

## Why the grain is the whole argument

A module's regions are not entered uniformly, and the spread is what a graph
cannot see. `query.ts` is 150 regions, loaded by 149 of the 188 test files —
and the median region among them is entered by 29, the cheapest by 1. The top
level of a hub module is reached by nearly everything. Its interior is reached
by a handful, and which handful is different for every branch.

Two orders of magnitude separate the two, and only something present while the
tests ran can tell them apart.

## Sixty commits, priced rather than run

The fork keeps a replay script that walks the sixty commits before the
instrumentation landed, asks the selector the same question at the same
coordinates, and counts what would have run. It checks no old code out. It
reports separately on the commits whose files have not moved since the
recording, because a commit is priceable against a record only while its line
numbers still mean what they meant.

Against 11,280 runs if you always run everything:

| | total | median | p90 |
| --- | --- | --- | --- |
| project graph | 10,207 | 168 (89%) | 188 (100%) |
| record as shipped | 11,220 | 187 (99%) | 187 (99%) |
| record + declared inert | **2,355** | **0 (0%)** | 187 (99%) |

Thirty-six of the sixty run nothing at all. On the thirty commits whose
coordinates are still exact the graph owes 4,917 runs and the record owes 315,
with a 90th percentile of 15 files — 8% of the suite — and twenty-five of the
thirty running nothing.

The distance between the second row and the third is one repository-specific
list, and it is the honest part of the exercise. Every reason a record cannot
answer produces a **shorter skip list, never a shorter run**: a path no run
ever read widens to the whole suite, which is why the uninformed row is worse
than the graph. Two causes account for all of it here:

- **Manifests.** 26 of the 29 widening paths are a `package.json`. No run
  enters a manifest, so no record holds one — but a manifest is a file a tool
  can read on its own, and `variance select` does not yet. That is the largest
  single gap this repository exposes.
- **Work that is compiled, not executed.** Type tests are checked by the
  compiler and never run, so no recording can hold one. This repository runs
  them as a separate target, and selection has to be told so.

## What it took to fit

One commit, and three things in it:

- One run over every package, not one run per package.
- Every project wrapped, and the root wrapped too. A Vitest project inherits
  neither plugins nor setup files from the configuration around it, so the
  projects carry the instrumentation and the root carries the reporter that
  folds one run into one record.
- A dispatcher that decides nothing. It asks `variance select` for a skip list,
  subtracts, and hands the rest to Vitest. Everything that makes the answer
  safe lives in the answer, not in the script.

```bash
git clone https://github.com/Variance-Authority/tanstack-query-example
cd tanstack-query-example && pnpm install
pnpm vitest run                        # records
node .variance-scratch/replay.mjs 60 c2231461^
```

Measured on an M4 Max with 64 GB under Node 26. A wall-clock figure is a
property of a machine as much as of a tool; the counts — files selected, runs
avoided — are the part that transfers.

See [Zod](selection-zod.md) for the same exercise on a repository where a
package graph has nothing to offer, [running less of the suite](selecting.md)
for what the selector does, and the [execution record](execution-record.md) for
what a region is.
