<p align="center">
  <a href="docs/visual-guidelines.md">
    <img src="assets/brand/variance-authority-logo.svg" alt="Variance Authority logo" width="800">
  </a>
</p>

# Variance Authority

**Understand the code. Investigate the behavior. Check the work.**

Variance Authority keeps fine-grained evidence of what your code did — across
hundreds of thousands of files and tests, over time — so that a question is
answered from that record instead of by running the whole suite again to find
out. The record has several readings, and none of them is the centre the others
depend on.

Find the names a workspace already publishes. Inspect a test while it runs.
Trace a changed interface back to its source. Select the tests an edit reaches.
Give your coding agent the same material to work from. Nothing is hosted;
compute, storage, browser capacity, credentials, and deployment stay yours.

## What are you working on?

Start with the question costing you time. Each path states the evidence it
needs and where its answer stops; take one on its own, or connect more of them
as the investigation grows.

| What do you need to do? | Start here |
| --- | --- |
| Help an agent work in this codebase | [Search exported names inside the import neighbourhood of the file you are editing](docs/agent-workspace-api.md), then inspect exact signatures and existing import sites. A readable checkout is enough. |
| Find out why this test is stuck | [Hold a Playwright test at a line you chose](docs/agent-interrogate.md) and inspect the page and announced work while that exact test is still running. |
| Run the tests this edit needs | [Combine source relationships with recorded execution](docs/selecting.md) to select affected test files, with the reason for each selection. Missing evidence widens the run. |
| Make one test smaller | [Find the modules loaded and components rendered that the test never used](docs/distill.md), try one substitution, and confirm it with the same test. |
| Understand an interface | [Measure grouping, spacing, alignment, emphasis, and repetition](docs/presentation.md) on the live page, make an edit, and measure again. |
| Explain what changed | [Keep text, accessibility, layout, styles, and pixels separate](docs/explain-variance.md), then trace a changed region to its component and source location. |
| Check whether the work did what you intended | [Compare the intentions declared before an edit](docs/reasoning.md) with its observed effects: what landed, what did not, and what changed outside the declared scope. |

## Give your coding agent the same evidence

Your agent keeps its editor, shell, and test runner. Variance supplies the
source facts and observations it reads, through the interfaces it already has.

- [**From the shell**](docs/agent-cli.md) — query the current workspace, a
  completed report, or a live watcher from the command line.
- [**Over MCP**](docs/agent-mcp.md) — the observations you supply become
  callable tools, including a test paused at an authored inspection point.
- [**As guided workflows**](docs/agent-workflows.md) — source discovery, live
  investigation, UI review, test selection, and test reduction, each carried
  through an edit and a check.

## One change, traced end to end

| Before | After | Diff |
| --- | --- | --- |
| ![A blue Variance button before the change.](examples/readme-case/artifacts/before.png) | ![The same Variance button in purple after the change.](examples/readme-case/artifacts/after.png) | ![The generated image diff, highlighting the repainted button in red.](examples/readme-case/artifacts/diff.png) |

The report names the cause and the source location:

```text
1 root(s): 0 authorized, 1 to review, 0 violation(s).
  [needs-review] Button — Button
      undeclared component change: `Button` (token/paint) reached 1 subject(s)
      examples/readme-case/src/Button.js:9
```

That is not a hand-written sample. It is
[`examples/readme-case/artifacts/report.txt`](examples/readme-case/artifacts/report.txt),
committed beside the three PNGs above, and
[`examples/readme-case`](examples/readme-case) regenerates all four. From a
checkout of this repository, after `yarn install`:

```bash
yarn workspace @variance-authority/example-readme-case generate
```

A cause that reaches several screens is decided once: accept a matching change
across the states it reached, and states carrying additional differences stay
open. Other examples cover [source selection](examples/selection-reuse),
[structural changes](examples/structural-change), and
[flake diagnosis](examples/dynamic-route-flake). The
[external cases](cases/README.md) exercise the packages against real hosts and
runners.

## Add it to a Playwright test

The fastest way in is a test that already gets the app into the UI state you
care about. Two installs, one call, one assertion:

```bash
npm install --save-dev @variance-authority/playwright-test @playwright/test
npx playwright install chromium
```

```ts
import { test } from '@playwright/test';
import { assertUnchanged, observe } from '@variance-authority/playwright-test';

test('the cart survives an empty basket', async ({ page }, testInfo) => {
  await page.goto('https://example.test/cart');
  await page.getByRole('button', { name: 'Clear' }).click();

  const observation = await observe(page, page.getByTestId('cart'), testInfo, {
    subjectId: 'cart/empty',
  });

  assertUnchanged(observation);
});
```

`cart/empty` is a **subject id**. A subject is one named UI state you asked for
and can ask for again — one Storybook story, one route at one viewport, one
component mounted in a test — captured and compared under an id you choose. The
first run reports `new`, because no baseline has been approved for that id yet;
promote that image with `npx playwright test --update-snapshots=all` and the next
run reports `unchanged`. Nothing accepts a first baseline on your behalf.

The test keeps its own runner, navigation, fixtures, and existing assertions.
[`@variance-authority/playwright-test`](packages/playwright-test/README.md)
has the rest.

### Or from the host you already have

| Your UI is already ready in | Integration recipe |
| --- | --- |
| A Playwright test | [`@variance-authority/playwright-test`: add an observation](packages/playwright-test/README.md#add-an-observation-to-a-test) |
| A Jest or Vitest jsdom test | [`@variance-authority/unit-test`: capture now, render later](packages/unit-test/README.md) |
| A Vitest browser-mode component test | [`@variance-authority/vitest-browser`: observe without leaving the test body](packages/vitest-browser/README.md#register-the-command) |
| A built or served Storybook | [`@variance-authority/storybook-collector`: integrate a Storybook](packages/storybook-collector/README.md#run-the-first-loop) |
| A running application or static build | [`@variance-authority/route-collector`: integrate a route list](packages/route-collector/README.md#put-one-route-through-review) |
| A custom renderer, store, or pipeline | [`@variance-authority/observe`: choose the entrypoint](packages/observe/README.md#choose-the-entrypoint) |

These packages add observation to the environment you already own. They do not
replace its test runner, fixtures, routing, or mounting.

To drive the whole loop from a config file instead of from inside a test, use
[`@variance-authority/cli`](packages/cli):

```bash
npm install --save-dev @variance-authority/cli
```

```bash
npx variance run --config variance.config.json
npx variance accept --config variance.config.json cart/empty
npx variance run --config variance.config.json
```

The first durable run exits `1` because its subjects are `new`. Accept the
subject ids you meant, then rerun; an unchanged run exits `0`.

## What else the same evidence answers

Once a run records what it rendered, what it executed, and what the source says,
the questions below are answerable from the same material. None of them sits
under another, and none requires the rest; take the one you need.

| What do you need to know? | Start here |
| --- | --- |
| How is information grouped, aligned, repeated, and emphasized in one live interface? | [`@variance-authority/presentation`](packages/presentation) measures the rendered boxes — spacing, alignment, prominence, repetition — and hands back numbers you assert on. It has no baseline and gives no design score. |
| At which step of a test did two runs stop agreeing? | [`@variance-authority/scenario`](packages/scenario) records the Arrange–Act–Assert steps a run actually took as a state machine, then compares two of them. |
| Which components and tests could — or did — a source change reach? | [`@variance-authority/sense`](packages/sense) joins what the source says can be reached with what a recorded run actually executed, and selects tests from it. It reads [more than JavaScript](docs/polyglot.md). |
| What public API does a workspace expose, and who consumes it? | [`@variance-authority/package`](packages/package) reads every entrypoint a manifest opens and what it exports; [`@variance-authority/help`](packages/help) answers questions about those names and their call sites over MCP. |
| What did a running system decide, and where did one execution go? | [`@variance-authority/event`](packages/event) lets code announce a decision so a test waits for it instead of guessing; [`@variance-authority/wire`](packages/wire) keeps one execution identity attached across processes; [`@variance-authority/vantage`](packages/vantage) makes a suite in flight something you can query rather than wait for. |
| How often has a cause recurred, drifted, or proved unstable? | [`@variance-authority/history`](packages/history) defines those answers over retained observations; [`@variance-authority/server`](packages/server) is the self-hosted HTTP service that retains them. |
| How does a person or agent inspect and decide on the evidence? | [`@variance-authority/mcp`](packages/mcp) exposes retained evidence to an MCP client; [`@variance-authority/tribunal`](packages/tribunal) is the self-hosted service where baselines and per-subject decisions are reviewed and approved. |

Each row has its own requirements — a browser, a live DOM, a filesystem, a
socket, a readable checkout — and none of them is imposed on the others.

## It reads more than JavaScript

The scan that answers *what can this change reach* is not limited to the
language the tool is written in. JavaScript and TypeScript in every dialect,
stylesheets, Python, Rust, Java, Kotlin and Swift are read into one graph, and a
diff that spans several of them is answered in one walk.

```bash
npx variance reach --since origin/main
```

That prints the files the change reaches, one per line, so you can hand them to
whatever runs them:

```bash
npx variance reach --since origin/main | grep '_test\.py$' | xargs pytest
```

There is no framework integration behind this and none is implied: the answer is
a list of paths on stdout, and what you do with it is yours. Because a run list
that comes back empty would look like a green build, `reach` never exits `0` with
nothing to say — an empty answer is an error, not a pass.
[How different languages are handled](docs/polyglot.md) states what the graph
does and does not claim.

## How the packages are cut

A package is cut around what its consumer must supply, which is why there are
many of them rather than one dependency graph you take whole.

The packages above are built from smaller ones you can also use directly:
`@variance-authority/core`, `@variance-authority/dom`,
`@variance-authority/react`, `@variance-authority/jsx-source`,
`@variance-authority/raster`, `@variance-authority/png`,
`@variance-authority/png-sharp`, `@variance-authority/session`,
`@variance-authority/playwright`, `@variance-authority/storybook`,
`@variance-authority/store`, `@variance-authority/report`, and
`@variance-authority/remote`. These are supported entrypoints, not internals: a
custom integration can acquire a document without rendering it, compare existing
rasters without a browser, or consume a report without reopening the system
under test.

The [architecture package map](docs/architecture.md#packages) names what every
package requires and what contract it owns. The
[information map](docs/information.md) shows how visual, source, runtime,
scenario, presentation, history, and review evidence remain separate and meet
only on identities their producers emitted.

## Where it fits

The [adoption gates](docs/gates.md) state where the tool fits Playwright,
Storybook, Jest, and Vitest — under jsdom and in browser mode. The
[product comparison](docs/comparison.md) states what Percy, Chromatic, Argos,
and Applitools provide that this project does not.

## Documentation

The full documentation is published at
[variance-authority.dev](https://variance-authority.dev), and its source is the
[`docs/`](docs/README.md) directory of this repository. The
[documentation index](docs/README.md) routes by question rather than by package;
use it to find the contract, measurement, or limitation behind any of the paths
above.

## Related projects

Two questions meet in this repository — *what did this change look like* and
*what did this change reach* — and each has its own prior art.

### Visual review

- [**Chromatic**](https://www.chromatic.com/) — hosted visual review built
  around Storybook, with TurboSnap deciding from the module graph which stories
  a change can reach. We ran on it for years, and it is still the reference for
  what a managed review service delivers.
- [**Argos**](https://argos-ci.com/) — visual review over the screenshots your
  own suite already takes, with an open-source self-host path. Its work on
  screenshot stabilization and masking is cited in
  [our own notes on flakiness](docs/flakiness.md) and
  [ignores](docs/ignores.md).
- [**testivai**](https://testiv.ai/) — local-first visual regression that pairs
  every screenshot with a DOM and computed-style snapshot so a diff arrives as a
  verdict rather than red pixels. The nearest thing to this project in spirit.

### Coverage, graphs, and test selection

- [**Wallaby.js**](https://wallabyjs.com/) — the deepest work anyone has done on
  per-test coverage. It instruments your source, keeps a matrix of which test
  covered which region, and re-runs the minimal affected set as you type; a line
  answers which tests reached it, in what order, carrying which values, and a
  profiler and a time-travel debugger read the same instrumentation. Nothing
  about per-test coverage or fine-grained selection is novel, and Wallaby is why.
  The difference is what the relation is *for*: Wallaby owns a live execution
  world and keeps it valid from keystroke to keystroke, and the
  [execution record](docs/execution-record.md) here is the same relation written
  down — a durable dataset a reviewer, a CI job, or a machine that never ran the
  suite can query later.
- [**Istanbul / nyc**](https://istanbul.js.org/) — the instrumentation and the
  file format the rest of the ecosystem reads. This repository runs V8's
  counters over its own suite for exactly that reason: a percentage from a
  counter with no stake in our answer.
- **Jest `--changedSince`, Vitest `--changed`, Playwright `--only-changed`** —
  selection from the import graph, which needs no recording and cannot see a
  route the graph does not carry.
  [What a record knows that no graph can](docs/selecting.md#what-a-record-knows-that-no-graph-can)
  is where the two readings part.
- [**Nx affected**](https://nx.dev/), [**Turborepo**](https://turborepo.com/),
  [**Bazel**](https://bazel.build/) — selection at the project or target grain,
  from dependencies you declare rather than executions anyone observed. Coarse,
  correct, and orthogonal: they decide which packages to build, and the record
  decides which tests inside one of them had a reason to run.
- [**TraceDecay**](https://github.com/ScriptedAlchemy/tracedecay) — source
  extraction across some sixty languages into one graph. The same appetite for
  reading a whole polyglot repository that
  [`variance reach`](docs/polyglot.md) has.

## Licence

MIT — see [LICENSE](LICENSE). Copyright (c) 2026
[Machine Garden](https://machine-garden.com/). [GitHub](https://github.com/Machine-Garden).
