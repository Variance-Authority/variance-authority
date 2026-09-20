# Selection on repositories nobody here controls

Two public TypeScript repositories run their unit suites through
[Variance Authority](README.md) and select from what the run recorded. Neither
was written with this in mind, neither had its tests changed to accommodate it,
and both keep a write-up in the repository that says what the record answered
and what it could not. This page is the short version of both, so you can judge
whether the shape applies to your tree before you clone anything.

The two were chosen because they fail differently. TanStack Query is 27
packages, and a package-grain selector already has something to say about it.
Zod is one package that 196 of its 202 test files import through a single
barrel, where a package-grain selector has nothing to say at all.

| | [TanStack Query](https://github.com/Variance-Authority/query) | [Zod](https://github.com/Variance-Authority/zod) |
| --- | --- | --- |
| Test files | 188 | 202 |
| Modules recorded | 259 | 122 |
| Regions recorded | 5,409 | 9,049 |
| Record on disk | 332 KB | 539 KB |
| Whole suite | 12.9s | 8.1s |
| One-line edit, selected | **10 files, 2.8s** | **2 files, 1.5s** |
| What a graph owes for the same edit | 168 files | 201 files |

## The same question asked of both

Change one line, ask, run what comes back.

In TanStack Query, inside `Query.fetch` in `packages/query-core/src/query.ts`:

```diff
-      if (observer) {
+      if (observer !== undefined) {
```

Ten test files across five packages, 2.84s. The project graph runs 168 of the
188, because 24 projects depend on `@tanstack/query-core` and every test in
them belongs to an invalidated project. That is the correct answer to the
question a graph asks. It is 16.8 times the answer to the question you wanted
asked.

In Zod, inside `getRussianPlural` in `packages/zod/src/v4/locales/ru.ts`:

```diff
-  if (lastDigit >= 2 && lastDigit <= 4) {
+  if (lastDigit >= 2 && lastDigit < 5) {
```

Two test files, 1.5s. Here the package graph offers 201 of 202 — on a
single-package library it is the whole suite with a rounding error. 131 of the
202 test files import the edited module, so 131 is the floor for anything
deciding at the grain of a file. The record answers 2, because it knows which
of those 131 executed the function rather than merely reaching it.

## Why the grain is the whole argument

A module's regions are not entered uniformly, and the spread is what a graph
cannot see. `packages/zod/src/v4/locales/ru.ts` is 50 regions:

```
  131 files    1-188   · module
    2 files    5-23    getRussianPlural · entry
    1 files   14-16    getRussianPlural · if#1/then
    2 files   16-16    getRussianPlural · if#1/else
    0 files  128-136   error/anon#0 · switch#0/case#0
```

Median 1, 90th percentile 2, maximum 131, and 21 of the 50 entered by nobody.
The hub modules behave the same way at a larger size: `core/schemas.ts` is
1,206 regions loaded by 130 test files with a median region entered by 7;
`core/compile.ts` is 686 regions, 130 loaders, median 4. In TanStack Query,
`query.ts` is 150 regions loaded by 149 test files, median 29, cheapest 1.

Two orders of magnitude separate a module's top level from its interior in both
repositories. Only something present while the tests ran can tell them apart.

## Sixty commits, priced rather than run

Each repository keeps a replay script that walks its last sixty commits, asks
the selector the same question at the same coordinates, and counts what would
have run. It checks no old code out. It reports separately on the commits whose
files have not moved since the recording, because a commit is priceable against
a record only while its line numbers still mean what they meant.

TanStack Query, against 11,280 runs if you always run everything:

| | total | median | p90 |
| --- | --- | --- | --- |
| project graph | 10,207 | 168 (89%) | 188 (100%) |
| record | **2,355** | **0 (0%)** | 187 (99%) |

Zod, against 12,120:

| | total | median | p90 |
| --- | --- | --- | --- |
| what the repository ships | 12,120 | 202 (100%) | 202 (100%) |
| package graph | 9,881 | 201 (100%) | 202 (100%) |
| record | **5,934** | **130 (64%)** | 199 (99%) |

Zod's median of 130 is the hub floor showing up again: a change spread across
several regions of `core/schemas.ts` and its neighbours does reach most of the
suite, and saying otherwise would be a lie the record refuses to tell. On the
commits where nothing in the core moved it runs nothing at all — 18 of the 60,
and 11 of the 14 whose coordinates are still exact.

## What widens, in both

Every reason a record cannot answer produces a **shorter skip list, never a
shorter run**. An empty answer means run everything. Three causes account for
all of the widening in both repositories, and each is a position rather than an
excuse:

- **Manifests.** 26 of TanStack Query's 29 widening paths are a `package.json`;
  23 of Zod's 31 are. No run enters a manifest, so no record holds one — but a
  manifest is a file a tool can read on its own, and selection does not yet.
  That is the largest single gap either repository exposes.
- **Work that is compiled, not executed.** Type tests are checked by the
  compiler and never run, so no recording can hold one. Both repositories run
  them as a separate target, and selection has to be told so.
- **Reads an instrument cannot see.** One Zod test reads
  `packages/docs/content/api.mdx` through the filesystem. That is a real
  dependency and an invisible one. It widens to the whole suite, which is the
  right answer, and it stays undeclared in the replay for exactly that reason.

## What it takes to fit one

Both migrations are small and both are one commit:

- One run over every package, not one run per package. A record cannot be made
  package by package — a `react-query` test entering `query-core` is the point,
  and two runs cannot see it.
- Every project wrapped, and the root wrapped too. A Vitest project inherits
  neither plugins nor setup files from the configuration around it, so the
  projects carry the instrumentation and the root carries the reporter that
  folds one run into one record.
- A dispatcher that decides nothing. It asks `variance select` for a skip list,
  subtracts, and hands the rest to the runner. Everything that makes the answer
  safe lives in the answer, not in the script.

Both repositories keep the replay and census scripts they were measured with,
untracked, so a figure on this page can be re-derived rather than believed.

## Reproducing either

```bash
git clone https://github.com/Variance-Authority/zod
cd zod && pnpm install
vitest run                      # records
node .variance-scratch/replay.mjs 60 HEAD~1
```

Measured on an M4 Max with 64 GB under Node 26. A wall-clock figure is a
property of a machine as much as of a tool; the counts — files selected, runs
avoided — are the part that transfers.

See [running less of the suite](selecting.md) for what the selector does,
[how the test-to-code map stays small](how-selection-scales.md) for why the
relation these records store stays affordable on a tree far larger than either
of these, and the [execution record](execution-record.md) for what a region is.
