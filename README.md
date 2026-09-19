<p align="center">
  <a href="docs/visual-guidelines.md">
    <img src="assets/brand/variance-authority-logo.svg" alt="Variance Authority logo" width="800">
  </a>
</p>

# Variance Authority

While your tests are running, the whole picture exists: which test entered which
code, what an interface rendered, what a workspace exports. The moment the run
ends it is discarded, and your next question costs another full run. Variance
Authority retains that evidence — hundreds of thousands of files and tests, over
time — so you can ask the record instead of running everything again. Nothing is
hosted; compute, storage, browser capacity, credentials, and deployment stay
yours.

## One change, traced end to end

This example changes only the `background-color` of one `Button`:

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

Other examples cover [source selection](examples/selection-reuse),
[structural changes](examples/structural-change), and
[flake diagnosis](examples/dynamic-route-flake). The
[external cases](cases/README.md) exercise the packages against real hosts and
runners.

## Add it to a Playwright test

The fastest way in is a test that already reaches the UI state you care about.
Two installs, one call, one assertion:

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
under another, and none requires the rest; take the one you are holding.

| What do you need to know? | Start here |
| --- | --- |
| How is information grouped, aligned, repeated, and emphasized in one live interface? | [`@variance-authority/presentation`](packages/presentation) measures the rendered boxes — spacing, alignment, prominence, repetition — and hands back numbers you assert on. It has no baseline and gives no design score. |
| At which step of a test did two runs stop agreeing? | [`@variance-authority/scenario`](packages/scenario) records the Arrange–Act–Assert steps a run actually took as a state machine, then compares two of them. |
| Which components and tests could — or did — a source change reach? | [`@variance-authority/sense`](packages/sense) joins what the source says can be reached with what a recorded run actually executed, and selects tests from it. |
| What public API does a workspace expose, and who consumes it? | [`@variance-authority/package`](packages/package) reads every entrypoint a manifest opens and what it exports; [`@variance-authority/help`](packages/help) answers questions about those names and their call sites over MCP. |
| What did a running system decide, and where did one execution go? | [`@variance-authority/event`](packages/event) lets code announce a decision so a test waits for it instead of guessing; [`@variance-authority/wire`](packages/wire) keeps one execution identity attached across processes; [`@variance-authority/vantage`](packages/vantage) makes a suite in flight something you can query rather than wait for. |
| How often has a cause recurred, drifted, or proved unstable? | [`@variance-authority/history`](packages/history) defines those answers over retained observations; [`@variance-authority/server`](packages/server) is the self-hosted HTTP service that retains them. |
| How does a person or agent inspect and decide on the evidence? | [`@variance-authority/mcp`](packages/mcp) exposes retained evidence to an MCP client; [`@variance-authority/tribunal`](packages/tribunal) is the self-hosted service where baselines and per-subject decisions are reviewed and approved. |

Each row has its own requirements — a browser, a live DOM, a filesystem, a
socket, a readable checkout — and none of them is imposed on the others.

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

## Licence

MIT — see [LICENSE](LICENSE). Copyright (c) 2026
[Machine Garden](https://machine-garden.com/). [GitHub](https://github.com/Machine-Garden).
