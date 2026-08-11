# Variance Authority

**Find the code behind the pixels.**

Visual regression is good at telling you that something changed. It is much
less useful at telling you why.

A padding token moves. Forty screenshots fail. The tool has found the visual
change, but the next hour still belongs to a reviewer: open the rectangles,
separate the real cause from everything that reflowed around it, and trace the
result back to source.

Variance Authority makes that investigation part of the run. It connects a
changed region to the component that caused it and the `file:line` where that
component lives. The screenshot remains evidence; it stops being the whole
answer.

This is a TypeScript library and a `variance` command-line tool that runs in
your own CI, against your own components. There is no account, no hosted
dashboard, and no build to upload.

## A review that starts with the cause

Here is one real Chromium comparison from
[`examples/todomvc`](examples/todomvc). A padding change in `Toggle` displaced
other content and produced 1,530 changed pixels:

```text
--- broken-toggle on page/todos--populated
what a pixel differ reports:  1530 pixels changed
what this reports:            5 region(s)
  cause       933px in 2 region(s) — Text     src/ds/components.tsx:42
  cause        86px in 2 region(s) — Toggle   src/ds/components.tsx:107
  collateral  511px in 1 region(s) — Stack    src/ds/components.tsx:27
```

The useful distinction is not 1,530 pixels versus five regions. It is `cause`
versus `collateral`. `Stack` was never edited; it only moved when the changed
component reflowed the page. By area it looks roughly six times more important
than the actual edit. By provenance it is correctly placed behind the two
components that changed.

That changes the review question from “which rectangles look suspicious?” to
“does this source change explain the components the run blamed?” One padding
token can still move forty screenshots, but it no longer has to create forty
separate investigations.

## The document knows what the image cannot

A PNG knows colours and coordinates. It does not know that a rectangle came
from `Toggle`, that `Stack` merely moved around it, or that both were rendered
from a particular source file.

Variance Authority therefore compares the **document a component rendered**,
not only its image. A run acquires the markup, the CSS that applies to it, the
component ownership chain, and the source provenance available from the
collector. It then asks each question at the cheapest representation that can
answer it:

- structure and authored CSS before a browser is needed;
- semantics under `jsdom` or Chromium;
- pixels only for differences that genuinely require rendering.

That same document can report things no before-and-after screenshot can find:
a control that never had an accessible name, or a string nobody translated.
When a profile cannot observe a band, the report says `unobserved`; it does not
turn missing evidence into a pass.

The result is one report for a person, a pull request, or a coding agent. It can
be JSON, a single HTML file, or an MCP response, and the process exits with a
verdict: `0` for nothing to review, `1` for changes to review, and `2` for an
operator error.

## Evidence, with its limits attached

The repository includes a head-to-head case against Playwright's real
`toHaveScreenshot`, using its runner and its default `pixelmatch` comparator
over the same page and clip. Eight changes were declared before either arm ran
and scored on whether a reviewer needed to be told:

```text
  Playwright defaults  3 hit, 3 miss, 1 hold, 1 deferral
  Playwright tolerant  2 hit, 4 miss, 1 hold, 1 deferral
  Variance Authority   6 hit, 1 false alarm, 1 deferral
```

This is evidence, not a universal win rate. The eight scenarios were selected
by this project because they separate the approaches; they are not a
representative sample of anyone else's suite, and they ran on one machine.
[`cases/incumbent-case`](cases/incumbent-case) contains the executable case.
[Journal 0014](docs/context/journal/0014-the-incumbent.md) records the two times
the measurement corrected this project's own expectations.

The broader corpus currently scores 38/38 under `jsdom` and 39/39 under
Chromium, after nine repairs fitted the rules to that corpus. It remains the
only corpus of its kind in the repository. The measurement and the evidence
still missing are tracked in [`docs/metrics.md`](docs/metrics.md).

## Scope and non-goals

**The technical bargain.**

Variance Authority is not a hosted visual-testing product. That removes an
account, an upload, and a per-snapshot meter. It also moves real responsibility
onto the team adopting it:

| You control | What that means |
| --- | --- |
| **Compute** | Rendering happens on your machines or on a pinned renderer you operate. |
| **Storage** | Baselines can live in a directory, git-LFS, or a service you deploy. Storage location does not change the verdict. |
| **Mounting** | Storybook, served URLs, and Playwright suites have shipped adapters. A custom component environment supplies its own collector and definition of “ready.” |
| **The gate** | The exit code integrates with any CI that runs a command. Pull-request comments and their credentials remain your workflow. |
| **Comparability** | Raster artifacts are keyed by renderer identity. Two incompatible identities are reported as `incomparable`, never `different`. |

This is a strong fit when source attribution, deterministic evidence, and
control of the pipeline matter more than a managed review experience.

Choose an established hosted product instead when you need a hosted dashboard,
retroactive review controls, a managed cross-browser or real-device grid, a
perceptual/ML differ, or an afternoon-from-`npm install` adoption path. The full
decision is in [`docs/gates.md`](docs/gates.md), and
[`docs/comparison.md`](docs/comparison.md) names what Percy, Chromatic, Argos,
and Applitools each do better.

## See the workflow run

No package tag has been published yet, so the honest evaluation path is this
repository. The Storybook case exercises a build produced by Storybook itself,
then drives the CLI through the workflow a team would use:

```bash
yarn install
npx playwright install chromium
yarn workspace @variance-authority/case-storybook build-storybook
yarn workspace @variance-authority/case-storybook build-storybook:changed
yarn build
yarn vitest run cases/storybook-case/src/cli.chromium.test.js
```

The test records nine new stories, accepts them, proves the next run is quiet,
then changes `Button` and finds exactly the five stories that render it. The
report resolves the change to `Button` and its source line. The complete case,
including the readiness and source-attribution boundaries it uncovered, is in
[`cases/storybook-case`](cases/storybook-case).

To connect a real suite, start with [`docs/surface.md`](docs/surface.md). It
shows what is required for Storybook, served routes, Playwright, jest or vitest,
and a collector you write yourself. Until the first release, installation from
a registry remains unavailable and is tracked by
[spec 0015](docs/specs/0015-the-first-published-release.md).

## Where to go next

| If you want to | Start here |
| --- | --- |
| Decide whether this can replace an existing bill | [`docs/gates.md`](docs/gates.md) for the three adoption gates, then [`docs/replacing.md`](docs/replacing.md) for the migration cost |
| Inspect the comparison evidence | [`cases/incumbent-case`](cases/incumbent-case) for the executable head-to-head and [`docs/metrics.md`](docs/metrics.md) for the measurement contract |
| Connect a frontend suite | [`docs/surface.md`](docs/surface.md) for the adoption surfaces and [`@variance-authority/cli`](packages/cli) for commands, reports, sharding, and CI |
| Choose baseline and history storage | [`docs/flows.md`](docs/flows.md) for six deployment shapes and [`docs/history.md`](docs/history.md) for what can accumulate across runs |
| Control noise without hiding it | [`docs/ignores.md`](docs/ignores.md) for subtree and difference-shape ignores, and [`docs/flakiness.md`](docs/flakiness.md) for instability |
| Run less work on a pull request | [`docs/selecting.md`](docs/selecting.md) for `--since`, its safe fallbacks, and its blind spot |
| Compose the library directly | [`@variance-authority/observe`](packages/observe) for the assembled API, [`@variance-authority/core`](packages/core) for the pieces, and [`@variance-authority/mcp`](packages/mcp) for agent access |
| Understand or contribute to the repository | [`docs/architecture.md`](docs/architecture.md) for the system map and [`docs/context`](docs/context/README.md) for the decisions and experimental record |

## Package map

Packages are named for what they require, so an integrator can see the cost of
an entrypoint before installing it. Detailed contracts stay in each package
README.

- **Host-free foundations:** [`@variance-authority/core`](packages/core),
  [`@variance-authority/raster`](packages/raster),
  [`@variance-authority/report`](packages/report),
  [`@variance-authority/history`](packages/history), and
  [`@variance-authority/storybook`](packages/storybook).
- **Environment-bound capabilities:**
  [`@variance-authority/dom`](packages/dom),
  [`@variance-authority/session`](packages/session),
  [`@variance-authority/react`](packages/react),
  [`@variance-authority/playwright`](packages/playwright),
  [`@variance-authority/png`](packages/png),
  [`@variance-authority/png-sharp`](packages/png-sharp),
  [`@variance-authority/store`](packages/store),
  [`@variance-authority/remote`](packages/remote),
  [`@variance-authority/server`](packages/server),
  [`@variance-authority/mcp`](packages/mcp), and
  [`@variance-authority/tribunal`](packages/tribunal).
- **Composed adoption surfaces:**
  [`@variance-authority/cli`](packages/cli),
  [`@variance-authority/observe`](packages/observe),
  [`@variance-authority/storybook-collector`](packages/storybook-collector),
  [`@variance-authority/route-collector`](packages/route-collector), and
  [`@variance-authority/playwright-test`](packages/playwright-test).

The dependency direction and the cost of each package are explained in
[`docs/architecture.md`](docs/architecture.md) and enforced by the repository's
boundary checks.

## Development

The repository requires Node 22 and Yarn 4 through Corepack.

```bash
yarn install
yarn build
yarn verify
```

`verify` runs lint, documentation and dependency-boundary checks, and the test
suite. Browser suites skip with a reason when Chromium is unavailable; install
it with:

```bash
npx playwright install chromium
```

Reproduce the two corpus measurements quoted above with:

```bash
yarn vitest run examples/kitchen-sink/src/measure.test.tsx
yarn vitest run examples/kitchen-sink/src/measure.chromium.test.tsx
```

Unfinished product work lives in [`docs/specs`](docs/specs/README.md); the
current implementation checkpoint lives in
[`docs/context/checkpoint.md`](docs/context/checkpoint.md).

## Licence

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Mechanic Garden.
