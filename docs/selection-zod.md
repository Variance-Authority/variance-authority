# Zod: 202 test files, 8 run

[Zod](https://github.com/colinhacks/zod) is one package, and 196 of its 202 test
files reach the code they exercise through a single barrel. A selector that
decides at the grain of a package therefore has nothing to say about it, and a
selector that decides at the grain of a file has almost nothing: change one
line and either one owes you the suite. Run the suite once through
[Variance Authority](README.md) and the same edit selects 8 runs, because the
record knows which of the files that *reach* a module covered the *lines* you
changed.

> **TLDR**
>
> - Over the sixty commits before it landed, the record skips **51% of all test
>   file runs** — 5,917 instead of 12,120.
> - Zod runs its whole suite on every change. The most a package graph could
>   save here is **18%**; put the record behind that graph and it skips
>   **40% more than the graph does alone**.
> - Change one line in `locales/ru.ts` and the record selects **8 runs, 1.6s
>   instead of 8.1s** — an **80%** shorter run. A package graph would still run
>   201 of the 202 files.
> - One commit of setup, and recording costs **1.02×** a suite run.

Nothing in the repository was written with this in mind and no test was changed
to accommodate it. One commit adds the instrumentation; the
[fork](https://github.com/Variance-Authority/zod-example) carries it, along
with the write-up and the scripts every figure below came from.

## The whole suite, once

| | |
| --- | --- |
| Test files | 202 |
| Test file runs | 398 |
| Tests | 5,656 |
| Wall clock | 8.1s |
| Modules recorded | 122 |
| Regions recorded | 9,049 |
| Record on disk | 539 KB |

There are more runs than files because two of Zod's Vitest projects collect the
same paths — `packages/zod/src/**/*.test.ts` runs once as itself and once under
a compile-mode project. A test file path is not unique within a run, and the
record stores the union rather than letting the second run overwrite the first.

## What the recording run cost

| | median of five |
|---|---|
| the suite as it ships | 8.87 s |
| recording | 9.05 s — **1.02×** |
| `vitest --coverage`, V8 provider | 11.56 s — **1.30×** |

Same pass and fail counts in all three, Vite cache and record cache cleared
between runs. Zod runs in `node`, which is why the third row is the interesting
one: the engine's counters are read per worker and answer with every script the
isolate has loaded, and a worker here holds 52. What it buys for that is one
union per file — every region some test covered, with no record of which test —
and its overhead is about fifteen times the recorder's.

## One line, asked of the record

Inside `getRussianPlural` in `packages/zod/src/v4/locales/ru.ts`:

```diff
-  if (lastDigit >= 2 && lastDigit <= 4) {
+  if (lastDigit >= 2 && lastDigit < 5) {
```

Eight runs over six distinct paths, 95 tests, 1.6s of wall clock against 8.1s.
Two of those six are the files the record selected; the other four are files it
refuses to speak for, which run every time. The package graph offers 201 of
202 — on a single-package library that is the whole suite with a rounding
error. 131 of the 202 test files import the edited module, so 131 is the floor
for anything deciding at the grain of a file.

## Why the grain is the whole argument

A module's regions are not covered uniformly, and the spread is what a graph
cannot see. `ru.ts` is 50 regions:

```
  131 files    1-188   · module
    2 files    5-23    getRussianPlural · entry
    1 files   14-16    getRussianPlural · if#1/then
    2 files   16-16    getRussianPlural · if#1/else
    0 files  128-136   error/anon#0 · switch#0/case#0
```

Median 1, 90th percentile 2, maximum 131, and 21 of the 50 covered by nobody.
The hub modules behave the same way at a larger size: `core/schemas.ts` is
1,206 regions loaded by 130 test files with a median region covered by 7;
`core/compile.ts` is 686 regions, 130 loaders, median 4.

Two orders of magnitude separate a module's top level from its interior, and
only something present while the tests ran can tell them apart.

## What the record will not speak for

It calls 198 of the 202 files whole, and a file that did not finish is not a
file it may skip. The four are worth naming, because neither reason is a bug:

- `packages/resolution/attw.test.ts` fails on this tree. It shells out to the
  repository's own build tool, and a file that ends in an error recorded
  nothing about the rest of itself.
- The three files in `packages/treeshake` are never instrumented. The root
  configuration lists `packages/*` as projects, and a directory with no Vitest
  configuration of its own gets a bare project that inherits neither plugins
  nor setup files.

Wrapping `packages/treeshake` is one file and it is the wrong answer. It raises
the record to 201 whole and 124 modules, but the 3,301 regions it adds are the
*built bundle*, not the source — so an edit to `src/ru.ts` would let the
selector skip tests that genuinely depend on that source, because what they
covered is an artifact no diff names. Leaving those three to run every time
costs 3 files out of 202 and is correct.

## Sixty commits, priced rather than run

The fork keeps a replay script that walks the sixty commits before the
instrumentation landed, asks the selector the same question at the same
coordinates, and counts what would have run. It checks no old code out. It
reports separately on the commits whose files have not moved since the
recording, because a commit is priceable against a record only while its line
numbers still mean what they meant.

Against 12,120 runs if you always run everything:

| | total | median | p90 |
| --- | --- | --- | --- |
| what the repository ships | 12,120 | 202 (100%) | 202 (100%) |
| package graph | 9,881 | 201 (100%) | 202 (100%) |
| record as shipped | 10,236 | 198 (98%) | 198 (98%) |
| record + declared inert | **5,917** | **130 (64%)** | 198 (98%) |

The median of 130 is the hub floor showing up again: a change spread across
several regions of `core/schemas.ts` and its neighbours does reach most of the
suite, and saying otherwise would be a lie the record refuses to tell. On the
commits where nothing in the core moved it runs nothing at all — 18 of the 60,
and 10 of the 13 whose coordinates are still exact.

The gap between the third row and the fourth is one repository-specific list.
Every reason a record cannot answer produces a **shorter skip list, never a
shorter run**: a path no run ever read widens to the whole suite. Seventeen of
the sixty commits widen that way, over fourteen distinct paths — and five of
those paths are a `package.json`, accounting for 24 of the 43 sightings. No run runs a manifest, so no
record holds one — but a manifest is a file a tool can read on its own, and
`variance select` does not yet. That is the largest single gap this repository
exposes.

One widening path stays undeclared on purpose. A test reads
`packages/docs/content/api.mdx` through the filesystem rather than through an
import, which is a real dependency and an invisible one. It widens to the whole
suite, which is the right answer for a dependency nothing recorded.

## What it took to fit

One commit, and three things in it:

- One run over every project, not one run per project. A record cannot be made
  package by package.
- Every project wrapped, and the root wrapped too. A Vitest project inherits
  neither plugins nor setup files from the configuration around it, so the
  projects carry the instrumentation and the root carries the reporter that
  folds one run into one record. Here that meant splitting the shared base into
  an unwrapped `vitest.root.mjs`, so the projects that merge it do not wrap
  twice.
- A dispatcher that decides nothing. It asks `variance select` for a skip list,
  subtracts, and hands the rest to Vitest. Everything that makes the answer
  safe lives in the answer, not in the script.

```bash
git clone https://github.com/Variance-Authority/zod-example
cd zod-example && pnpm install
vitest run                             # records
node .variance-scratch/replay.mjs 60 796e1360^
```

Measured on an M4 Max with 64 GB under Node 26. A wall-clock figure is a
property of a machine as much as of a tool; the counts — files selected, runs
avoided — are the part that transfers.

See [TanStack Query](selection-tanstack-query.md) for the same exercise on a
27-package monorepo, [running less of the suite](selecting.md) for what the
selector does, and the [execution record](execution-record.md) for what a
region is.
