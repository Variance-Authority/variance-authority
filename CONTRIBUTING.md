# Contributing

You are about to change this repository. This page is how you work in it: what
to install, what `verify` holds you to, how to run less than the whole suite
while an edit is still open, how to reproduce the behaviour the documentation
claims, and what a change owes a release.

## Set up

You need Node 22 or newer and Yarn 4 through Corepack (`corepack enable`); the
exact Yarn version is pinned as `packageManager` in the root
[`package.json`](package.json). **Every command on this page runs from the
repository root.**

```bash
yarn install
yarn build
yarn verify
```

`verify` is `yarn lint && yarn check && yarn measure && yarn test`: oxlint, the
repository checks in `tools/*.check.ts` — every link resolves, every path named
in prose exists, every `file:line` lands where it says, every package declares
what it imports — the `*.measure.ts` cost gates, and the test suite. Browser
tests skip with a reason when Chromium is unavailable; install it with:

```bash
npx playwright install chromium
```

Build before you verify, and again after you pull. Nothing here imports another
package by relative path, so a check that asks the CLI what a setting means
resolves through the manifest's `exports` into `dist/`, the same path a consumer
takes. A missing build says so; a stale one answers every question fluently and
answers some of them wrong, and the wrong answer arrives dressed as a defect in
whatever was asked about.

## What runs what, and when

The suite is three slices. The file name puts a test in one, and `yarn test`
runs them one after another, so each has the machine to itself:

| Slice | Files | What a test may start | Workers | Config |
| --- | --- | --- | --- | --- |
| `unit` | `*.test.*` | `git`, `rg`, `ps`, `sw_vers`, `esbuild` | one per core | [`vitest.config.mts`](vitest.config.mts) |
| `integration` | `*.integration.test.*` | the CLI out of `dist`, or a test runner over a fixture | a quarter of the cores | [`vitest.integration.config.mts`](vitest.integration.config.mts) |
| `chromium` | `*.chromium.test.*` | Chromium, directly or through Playwright | an eighth of the cores | [`vitest.chromium.config.mts`](vitest.chromium.config.mts) |

They are apart because a file that starts a process or a browser costs several
cores. Run beside the in-process tests at one fork a core, they held a load
average three times the core count. A unit test that starts any program outside
its list fails, naming the program it started and the name the file should have
([`tools/in-process.ts`](tools/in-process.ts)).

Each slice is a suite declared in [`variance.config.json`](variance.config.json)
and keeps its own record, because what a test in it can be seen to execute
differs. The probes are in the test's process. An integration test's record
holds what the test ran on its way to starting the CLI, and nothing the CLI ran.

```bash
yarn test               # unit, then integration, then chromium; stops at the first red slice
yarn test:unit          # one slice; each takes vitest's arguments
yarn test:integration
yarn test:chromium
```

`yarn verify` runs all three on your machine. In CI, the check workflow runs
them on every pull request and every push to `main`, without Chromium, so the
chromium slice reports itself skipped there. The coverage comment compares the
unit slice against `main`'s record, and lists what the integration slice
executed without a comparison.

## Running less than the whole suite

`yarn test` records which test file executed which part of which module, and
writes that to a snapshot for each slice. `yarn test:since` runs the same three
slices with `VARIANCE_AUTHORITY_SINCE` set, and each slice's runner drops the
files your change did not reach before it starts any:

```bash
yarn test:since                             # since the commit each test last ran at
VARIANCE_AUTHORITY_SINCE= yarn test:unit    # one slice
yarn variance select --suite unit           # print the reading, run nothing
```

The variable is read by `withTestSelection`, the seam each slice's config is
wrapped in, which is the seam this repository ships. Set and empty, it selects
from the commit the snapshot names. Set to a ref, it also names the base for a
snapshot that names no commit of its own. The runner prints one line
before it starts: `selected 12 of 676`, `selected none of 676`, or
`declined: <why>` when the reading could not be made and the slice runs whole.
Nothing else changes: `--shard`, a file filter and the reporters are Vitest's.
Watch mode does not select.

It selects on what the snapshot measured, and on nothing else. A changed file
the snapshot has no row for — a stylesheet, a file added since the recording —
is asked of the import graph, and the nearest measured files that import it
select their tests. One the graph does not list either — a README, a fixture —
selects nothing, and the reading names it in one line. What the harness loads
without importing it is declared: the Vitest seam declares `vitest.config.mts`
and the local modules it imports, and the config names the rest in
`preconditions`. A change to any of them selects every test. A test file the
snapshot has never seen runs.

So a green `test:since` is a smaller claim than a green `verify`, and `verify` is
the gate.

Each selected test also carries its distance from the change: how many imports
separate them, counted through the modules that test actually entered. The
nearest tests fail first and for the simplest reason, so you can run them while
the edit is still open and leave the rest for later:

```bash
VARIANCE_AUTHORITY_AT_DISTANCE=0-2 yarn test:since   # within two imports of the change
VARIANCE_AUTHORITY_AT_DISTANCE=3- yarn test:since    # the rest of the selection
```

`0-2` means *no more than two imports away*. Zero is a test whose own source you
edited. `2` is exactly two, and `3-` is three or more. Tests whose distance
could not be measured run with the leg that reaches the end, so those two
commands together run every selected file. `yarn verify:near` and
`yarn verify:far` are those two legs. [`docs/distance.md`](docs/distance.md) is
the reference, and `yarn variance select --suite unit --at-distance 0-2` prints
what a leg would run.

## Which named tests a change reached

`yarn test` records which *files* entered each region and, beside that, which
named *cases* did. A review asks the narrower question — of the two hundred
cases in those files, which ones walked the branch that changed:

```bash
yarn test
variance covering --file packages/jsx-source/src/record.ts --line 99
variance covering --since main
```

The case recording is cheap: the suite runs its cases one at a time, so the
case a crossing joins is a variable rather than a scope to look up. Measured on
zod's suite — 5,656 cases, ten interleaved repetitions of each arm, median of
the runner's own `tests` figure — it spends 6.1% more time inside the tests
than a file-level recording, and 3.5% more on TanStack Query. Instrumenting at
all is the larger half: 6.9% on zod and 4.0% on TanStack Query over an
uninstrumented run. The index lands in the record, as a section of the
coverage file, and is a few hundred kilobytes on this repository.

Add `continuations: true` to `selection` in
[`vitest.config.mts`](vitest.config.mts) when a case's work outlives the case —
a test that is synchronous to the runner and starts something asynchronous
underneath, which is what breaks the test after it. Each case then gets an
async context, the file names the cases that crossed a region after they had
settled, and the run pays 4.7 nanoseconds a crossing more than the variable
does — 6.3 ns against 1.6, of which 5.5 is `getStore()` itself. On the same zod
measurement the two arms do not separate: the crossing count predicts 0.2%, and
ten interleaved repetitions cannot resolve that against the suite's own spread.
The microbenchmark separates them and a suite does not. Without it, a file
whose cases overlap is recorded as a whole and the run says which two cases
overlapped.

`variance covering` prints the named tests that reached a line, and
`--at-distance <hops>` or `--in-package` narrows them to the ones written near
it. An empty list there means *no case entered this region*, which is the
sentence that gets a test written — but only when the index is current, so
record before you read.

`--since <ref>` asks the same of everything a diff touched, which is what a
review wants: every changed region with the cases that entered it, counting the
regions nothing entered and the regions one case alone entered. A changed test
file is answered with the cases it declares rather than reported as unmeasured,
and a changed path with no row says so.

## A second opinion on the suite

Everything above is this repository's own instrument reading its own run. For a
reading nobody here wrote:

```bash
yarn test:coverage
```

That is the same suite under V8's counters — statements, branches, functions,
lines, per file and in total — with our probes taken away, because a provider
reading probed output would attribute counts to lines you never wrote.
[`tools/coverage.config.mts`](tools/coverage.config.mts) is the whole
configuration, and it re-exports the suite rather than restating it.

Nothing gates on the percentage. It is here so that a claim about what the
record saw can be checked against a counter with no stake in the answer, and so
that a module no test has ever entered shows up as a module no test has ever
entered. The report lands in `coverage/`, which is not tracked.

## Reproduce the documented behavior

[`cases/storybook-case`](cases/storybook-case) builds a real Storybook with
`storybook build`, records its stories, accepts them, checks that the next run is
quiet, then builds a second Storybook in which `Button` — from
`cases/storybook-case/src/ds.jsx` — renders wider, and checks that the report
resolves that change back to the component and its source line. It needs
Chromium and a current `yarn build`, because the test drives the CLI as a
process out of `packages/cli/dist`:

```bash
yarn workspace @variance-authority/case-storybook build-storybook
yarn workspace @variance-authority/case-storybook build-storybook:changed
yarn build
yarn test:chromium cases/storybook-case/src/cli.chromium.test.js
```

The corpus measurements quoted in the root [`README.md`](README.md) come from two
files in [`examples/kitchen-sink`](examples/kitchen-sink); the first runs under
jsdom and needs no browser, the second needs Chromium:

```bash
yarn test:unit examples/kitchen-sink/src/measure.test.tsx
yarn test:chromium examples/kitchen-sink/src/measure.chromium.test.tsx
```

## Releasing

A change that reaches the registry arrives carrying a changeset, and the
`changeset` step of `check.yml` refuses a pull request that changes a published
package without one:

```bash
yarn changeset          # what the change does, and the bump
yarn changeset --empty  # the change ships nothing worth a changelog line
```

Pick the bump the *product* deserves. The packages are one `fixed` group — every
`@variance-authority/*` package shares a version, because internal dependencies
are `workspace:^` and a release ships all of them — so marking one marks them
all. [`.changeset/README.md`](.changeset/README.md) says what else is unusual
here.

**No merge publishes anything.** [`release.yml`](.github/workflows/release.yml)
collects the changesets on `main` into one "Version packages" pull request;
merging that moves the version numbers and writes the changelogs, and still
sends nothing to a registry. Publishing is the `release` workflow run by hand,
from the Actions tab, on whatever `main` carries at that moment — it refuses to
run while a changeset is still waiting to be versioned. The dist-tag is derived
from the version rather than typed at release time.

## Where the rest lives

The standards a change is held to — where each kind of writing goes, how a
status claim is recorded, and how a package is named — are in
[`AGENTS.md`](AGENTS.md) and the phase references it routes to in
[`.agents/references/`](.agents/references/). Unfinished product work lives in
[`docs/specs`](docs/specs/README.md); the current implementation checkpoint lives
in [`docs/context/checkpoint.md`](docs/context/checkpoint.md).
