# TanStack Query: 78% fewer test file runs than Nx

[TanStack Query](https://github.com/TanStack/query) is 27 packages, so a
package-grain selector already has a useful answer: change
`query-core` and it runs the 24 packages that depend on it. That is the correct
answer to the question a graph answers, and it is 168 of the 188 test files. Run
the suite once through [Variance Authority](README.md) and the record answers
the question you wanted asked — which tests covered the lines you changed —
with 9.

> **TLDR**
>
> - Over the sixty commits before it landed, each checked against a record made
>   at its parent commit, `nx affected` selects 3,464 test file runs of 11,280.
>   The record selects **775, 78% fewer than Nx**.
> - The walk from what the edit changed selects **441**, and the file graph
>   1,470. The record selects more than the walk on commits that change a
>   manifest the Vite configuration reads, and one file more on every commit.
> - Change one line in `query-core` and the record selects **9 test files**,
>   where `nx affected` selects 168. A coarser
>   [precision](selecting.md#how-precisely-a-suite-selects) runs 83, then 149:
>   the import graph adds nothing to what coverage already says.
> - What limits `file-use` here is `query-core`'s index, which loads every
>   module it re-exports: an edit to `hydration.ts` runs 149 test files, and
>   21 of them call a function in it.
> - One commit of setup, and recording costs **1.08×** a suite run.

Nothing in the repository was written with this in mind and no test was changed
to accommodate it. One commit adds the instrumentation; the
[fork](https://github.com/Variance-Authority/tanstack-query-example) carries
it, along with the write-up and the scripts every figure below came from.

## The whole suite, once

| | |
| --- | --- |
| Test files | 188 |
| Tests | 4,523 |
| Wall clock | 12.7s |
| Modules recorded | 259 |
| Regions recorded | 5,409 |
| Record on disk | 332 KB |

The record is one file for the whole workspace. It has to be: a `react-query`
test covering `query-core` is the observation the whole thing rests on, and two
separate runs cannot see it.

## What the recording run cost

| | median of five |
|---|---|
| the suite as it ships | 11.78 s |
| recording | 12.77 s — **1.08×** |
| `vitest --coverage`, V8 provider | 15.25 s — **1.29×** |

Same pass and fail counts in all three — the 22 that fail in the upstream
repository fail in each — with the Vite cache and the record cache cleared
between runs. This suite runs in jsdom, so a worker holds 193 scripts against
Zod's 52. A probe is paid for by the test that reaches it and does not notice;
the engine's counters are read rather than fired, and a read answers with the
whole isolate. Read as often as a selector needs them — after every test, not
once per worker — the same counters cost 2.1× to 2.7× the suite, and that is
with the result thrown away.

## One line, asked of the record

Inside `Query.fetch` in `packages/query-core/src/query.ts`:

```diff
-      if (observer) {
+      if (observer !== undefined) {
```

Nine test files across five packages, 758 of the suite's 4,523 tests. The graph
runs 168, because every test in an affected project counts as affected; the
repository's own `test:pr` is `nx affected`, so that is not a hypothetical
selector. Both answers are defensible; one of them is 18.7 times the other.

```mermaid
xychart-beta horizontal
  accTitle: Test files selected for a one-line change in query-core
  x-axis ["the record", "nx affected", "every test file"]
  y-axis "test files" 0 --> 190
  bar [9, 0, 0]
  bar [0, 168, 0]
  bar [0, 0, 188]
  bar [0, 0, 0]
```

## Why the grain is the whole argument

A module's regions are not covered uniformly, and the spread is what a graph
cannot see. `query.ts` is 150 regions, loaded by 149 of the 188 test files —
and the median region among them is covered by 29, the cheapest by 1. The top
level of a hub module is reached by nearly everything. Its interior is reached
by a handful, and which handful is different for every branch.

Two orders of magnitude separate the two, and only something present while the
tests ran can distinguish them.

## Two lines, at each precision

A suite declares how precisely it selects with its
[`precision`](selecting.md#how-precisely-a-suite-selects): a skipped test is a
cost you cannot see, so you start coarse and declare a finer step once you trust the record.
Every step reads the same record, so nothing is recorded again. Asked about the
one-line change above, and about one in the devtools' `PiPProvider`, in
`packages/query-devtools/src/contexts/PiPContext.tsx`:

```diff
-    disabled: props.disabled ?? false,
+    disabled: props.disabled === true,
```

each step runs:

| `precision` | A test runs when | `query.ts` | `PiPContext.tsx` |
| --- | --- | --- | --- |
| `file` | it imports a changed file, or it loaded one | 149 | 11 |
| `symbol` | it imports an export the change altered, or it loaded a changed file | 149 | 11 |
| `file-use` | it loaded a changed file | 149 | 7 |
| `function-use` | it entered the function a changed line is in | 83 | 4 |
| `region-use` | it entered the region a changed line is in — the default | **9** | **4** |

Each step runs every test the next finer step runs, out of 188 test files.

The two steps that read the import graph work, and here they buy nothing over
coverage. `file-use` is what a coverage report already says: which tests loaded
the file. `file` and `symbol` add only the tests that import a file without
loading it, and Vitest loads what a test imports, so on `query.ts` every
importer is a loader and the three tie at 149. The devtools open their panel
through a lazy `import()`, so four tests import `PiPContext.tsx` and never load
it: `file` and `symbol` run them, and `file-use` does not. The graph runs more
than coverage, never less.

The steps that read inside the file run fewer. 83 test files entered `Query.fetch`, and 9
the branch the edit changed; 4 entered `PiPProvider`, and nothing in it splits
them further.

To ask it yourself, record once on the
[fork](https://github.com/Variance-Authority/tanstack-query-example):

```bash
git clone https://github.com/Variance-Authority/tanstack-query-example
cd tanstack-query-example && pnpm install
pnpm vitest run                        # records
```

Make either edit, then ask once per step. The fork's
`variance.config.json` declares only this suite, so each write replaces nothing
else:

```bash
for precision in file symbol file-use function-use region-use; do
  echo "{ \"suites\": { \"unit\": { \"kind\": \"unit\", \"precision\": \"$precision\" } } }" > variance.config.json
  pnpm variance select --suite unit --since HEAD
done
```

Each answer lists the test files it skips, and says on stderr how many of the
recorded test files that is; the rest run.

## What the index costs `file-use`

Almost every test here imports `query-core` through its index,
`packages/query-core/src/index.ts`, and the index loads every module it
re-exports. A test that loaded a module counts at `file-use` as a test that
used it. So an edit to the top level of `hydration.ts` runs 149 test files at
`file-use`, the same as at `file`, and 121 of those 149 never ran a line of it.

[Distill](distill.md) measures this for the whole suite, from the same record:

```bash
pnpm variance distill --suite unit
```

Of the lines the unit tests load, 47% are in modules that no case of the
loading test file ran: 704,221 of 1,502,799, across 2,715 of 5,700 module
loads. The heaviest come through the index:

| Module | Test files that load it | Load it and run none of it |
| --- | --- | --- |
| `queriesObserver.ts` | 149 | 120 |
| `hydration.ts` | 149 | 121 |
| `mutationObserver.ts` | 149 | 108 |
| `infiniteQueryObserver.ts` | 149 | 122 |
| `streamedQuery.ts` | 149 | 138 |

The index is the cause, not the selector. Of the 149 test files that load
`hydration.ts`, 21 call a function in it, and `variance covering --file
packages/query-core/src/hydration.ts` lists them. If the module loaded at its
first call, an edit to its top level would run those 21. Under Vitest it
cannot load that way without making `hydrate` return a Promise, so for this
repository the change is in the imports: the tests and packages that need
hydration would import it from an entry `query-core` declares for it, as
[running less of the suite](selecting.md#from-file-to-file-use-load-a-module-where-it-is-used)
describes.

## Sixty commits, each against its own parent

The fork keeps a replay script for the sixty commits before the instrumentation
landed. For each one it checks out the commit's parent, records the suite
there, then checks out the commit and queries which test files its change needs.
Every count is in one unit: the test files in the parent's record, 188 on
every commit. A file selected on five commits counts five times.

Four selectors answer the same sixty questions. `nx affected` is what the
repository runs on every pull request. The replay script names its inputs:
prose, examples, CI and type tests are not inputs to the unit suite. The other
three are Variance Authority: the file graph (`variance reach
--whole-files`), the walk from what the edit changed (`variance reach`), and the
record (`variance select`).

```mermaid
xychart-beta horizontal
  accTitle: Test file runs selected over sixty TanStack Query commits
  x-axis ["reach", "the record", "file graph", "nx affected", "run everything"]
  y-axis "test file runs" 0 --> 11500
  bar [441, 0, 0, 0, 0]
  bar [0, 775, 0, 0, 0]
  bar [0, 0, 1470, 0, 0]
  bar [0, 0, 0, 3464, 0]
  bar [0, 0, 0, 0, 11280]
```

| | total | median | p90 | selects nothing on |
| --- | --- | --- | --- | --- |
| run everything | 11,280 | 188 | 188 | 0 |
| `nx affected` | 3,464 | 0 | 188 | 36 |
| the file graph | 1,470 | 0 | 143 | 42 |
| the walk from what changed | **441** | 0 | 0 | 55 |
| the record | **775** | 1 | 23 | 0 |

The file graph and Nx both widen on a hub. Five commits edit comments in
`query-core`'s `types.ts`, which nearly every test imports, and the file graph
selects 143 or 144 on each of them, and Nx 168. The walk reads both texts of each changed file,
finds that nothing that runs has changed, and selects none.

Where a commit changes code, the record selects fewer than the walk, because it
records which of the files that import a module ran the lines that changed.
Three `fix(query-core)` commits select 143 from the walk; the record selects 67,
47 and 23.

Where a commit changes a package manifest, the record selects more than both
walks, and that is correct. Nx selects 188 on those commits. Each project's Vite
configuration imports its own `package.json`, so a manifest is part of the
configuration its tests ran under. Neither walk treats a manifest as a changed
file. The record reruns the tests of the projects whose configuration changed,
and no others: a commit that changes the devtools manifests reruns 14 files, and
the three that change nearly every package's manifest rerun 179 to 181. Those
four commits are 553 of the record's 775.

The record selects at least one file on every commit, because one file here
fails in the upstream repository on every commit, and a file that did not pass
is a file the record does not speak for. It runs every time.

Type tests are files no run reads. The compiler checks them and nothing
executes them, so no recording has a row for one, and a change to one selects
nothing from the record. This repository runs them as a separate target, and
that target owns them.

## What it took to fit

One commit, and three things in it:

- One run over every package, not one run per package.
- Every project wrapped, and the root wrapped too. A Vitest project inherits
  neither plugins nor setup files from the configuration around it, so the
  projects carry the instrumentation and the root carries the reporter that
  folds one run into one record.
- A dispatcher that decides nothing. It calls `variance select` for a skip list,
  subtracts, and hands the rest to Vitest. Everything that makes the answer
  safe lives in the answer, not in the script.

```bash
git clone https://github.com/Variance-Authority/tanstack-query-example
cd tanstack-query-example && pnpm install
pnpm vitest run                        # records
node .variance-scratch/replay.mjs 60 c2231461
```

Measured on an M4 Max with 64 GB under Node 26. A wall-clock figure is a
property of a machine as much as of a tool; the counts — files selected, runs
avoided — are the part that transfers.

See [Zod](selection-zod.md) for the same exercise on a repository where a
package graph has nothing to offer, [running less of the suite](selecting.md)
for what the selector does, and the [execution record](execution-record.md) for
what a region is.
