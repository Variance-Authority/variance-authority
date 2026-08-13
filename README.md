# Variance Authority

A visual regression run tells you that forty screenshots changed. It does not
tell you that one padding token moved, or which component holds it, so the hour
after a red build is a bisect. This project makes that the output instead: a
change resolves to the component that caused it and the `file:line` it lives in.

## What a run hands you instead of a rectangle

A real Chromium screenshot pair, taken through mask → regions → box tree → owner
chain → file (`examples/todomvc/src/observe.chromium.test.ts`, 10 tests):

```text
--- broken-toggle on page/todos--populated
what a pixel differ reports:  1530 pixels changed
what this reports:            5 region(s)
  cause       933px in 2 region(s) — Text     src/ds/components.tsx:42
  cause        86px in 2 region(s) — Toggle   src/ds/components.tsx:107
  collateral  511px in 1 region(s) — Stack    src/ds/components.tsx:27
```

`cause` versus `collateral` is the load-bearing half. `Stack` was never edited,
only reflowed, and by area it outranks the real edit roughly 6× — so ranking has
to come from the tier that has provenance, not from pixel count.

Against a real incumbent rather than a model of one: `cases/incumbent-case`
installs `@playwright/test` and runs *its* runner and *its* `toHaveScreenshot`
over the same page and clip, record on trunk, compare on branch. Eight edits,
declared with their arguments before either arm ran, scored on *must a reviewer
be told?* rather than *did the image change*:

```text
  incumbent (defaults)  3 hit, 3 miss, 1 hold, 1 deferral
  incumbent (tolerant)  2 hit, 4 miss, 1 hold, 1 deferral
  ours                  6 hit, 1 false alarm, 1 deferral
```

Read it with its conditions attached: the comparator is `pixelmatch` at
Playwright's defaults, on one machine, and the eight scenarios were chosen by us
because we believe they separate the tools, which is not a representative sample
of anyone's suite. [`cases/incumbent-case`](cases/incumbent-case) is the case
itself, and [journal 0014](docs/context/journal/0014-the-incumbent.md) the
account, including the two corrections the run forced on our own declared corpus.

## How it does that

The attribution comes from what is compared. The unit of review is the
**document** a component rendered, not the image — a run acquires markup plus the
CSS that applies to it, settles what the document alone can settle, and renders
only what is left. The same representation reports defects no comparison reaches
— a control that never had an accessible name, a string nobody translated — and
lets most subjects never cost a screenshot.

It is a TypeScript library and a `variance` binary, not a service: there is no
account, no dashboard, and nothing to send a build to. You run it in your own
CI, against your own components, and it exits `0`, `1` or `2`.

If you already operate Argos, Chromatic or Percy, the material differences are
in [scope and non-goals](#scope-and-non-goals) and
[what you own](#what-you-own). [`docs/replacing.md`](docs/replacing.md) covers
what moving actually costs, and
[`docs/comparison.md`](docs/comparison.md#5-when-not-to-choose-this) lists ten
conditions under which one of those products is the better answer.

**Maturity and distribution.** One milestone is complete: the pipeline runs end
to end under both observation profiles and scores 38/38 and 39/39 against a
corpus whose ground truth was declared before the run — agreement *after* nine
repairs fitted the rules to that corpus, which is still the only one that exists
([`docs/metrics.md`](docs/metrics.md)). The packages are MIT and
publishable, and distribution is from source until the first release
([spec 0015](docs/specs/0015-the-first-published-release.md)). What is unfinished
is [`docs/specs/`](docs/specs/README.md), a directory whose entry criterion is
that everything in it is incomplete.

## A first run

No tag has been pushed, so there is nothing to `npm install` yet: a first run
means this workspace. The shortest honest path is the Storybook one, because it
is the collector that ships rather than the one you write.

```bash
yarn install && yarn build
npx playwright install chromium
```

Point a config at a built Storybook and say where the components live:

```json
{
  "project": "my-app",
  "profile": "chromium",
  "subjects": {
    "kind": "storybook",
    "index": "storybook-static/index.json",
    "collector": "collector/index.mjs"
  },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "report": ".variance/run.json"
}
```

The collector it names is five lines, and `ready` is the only per-story fact it
cannot infer — a story that defers work is *not* rendered when Storybook says it
is, and guessing there is how you photograph a spinner:

```js
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  ready: { 'surface--deferred': '[data-testid="ready"]' },
  source: { dirs: ['src'] },
});
```

Then the loop, which is three commands and an exit code. Until the first release
the binary is `node packages/cli/dist/bin.js`; a published install puts the same
thing on `PATH` as `variance`:

```bash
variance run                 # 1 on a first run: every subject is new
variance accept --all        # first run only — see below
variance run                 # 0, or 1 with the component and file that moved
```

`0` is nothing to review, `1` is changes to review, `2` is operator error — a
verdict and a crash never share a code. `accept` promotes an image the run
produced and never renders one, but `--all` cannot yet tell a never-reviewed
subject from a just-regressed one, so after that first run name the subjects or
use `--shape` ([spec 0023](docs/specs/0023-accept-tells-new-from-changed.md)). `variance doctor` says what a machine can
observe before a run rather than after one.
[`cases/storybook-case`](cases/storybook-case) is this exact arrangement, run end
to end against a real Storybook; [`docs/surface.md`](docs/surface.md) is the same
question for a Playwright suite, a served URL map, or components you mount
yourself.

## Scope and non-goals

**In scope.** Regression detection at component granularity with a component and
`file:line` attached; accessibility and localization findings from a single
render; a report a person, a pull request or an agent can read; storage you
choose, from a directory to a service you deploy.

**Out of scope**, each a decision rather than a backlog item:

- **No hosted anything.** Nothing is metered, nothing is stored on your behalf,
  and there is no account. The corollary is the whole of
  [what you own](#what-you-own).
- **No perceptual or ML differ.** Every comparison is deterministic and
  reproducible from the artifacts.
- **No ingest of foreign images.** There is no verb that takes a PNG from
  elsewhere. A baseline is bytes *plus* the identity and document that produced
  them, and everything above rests on the second half —
  [`docs/surface.md`](docs/surface.md) states the arithmetic.
- **No review UI in the tool.** The report is JSON, a single HTML file, or MCP.
  A review-and-approve surface exists as a service you deploy yourself
  ([`tribunal`](packages/tribunal)).
- **No cross-browser grid.** Three engines run and one is selected per run; a
  matrix, mobile and real devices are out. What is unfinished rather than
  declined is narrower, and tracked: no stabilization recipe declares which
  engines verified it, and the corpus has never been run twice
  ([spec 0020](docs/specs/0020-a-cross-browser-grid.md)).
- **No retries and no tolerances.** A subject that will not hold still is
  reported, not re-observed — [`docs/flakiness.md`](docs/flakiness.md) is the
  position, and the three causes its own table says nothing absorbs. What you
  *can* say is that a
  subtree or a difference shape is not the subject, and every run tells you what
  each of those absorbed and which of them absorbed nothing
  ([`docs/ignores.md`](docs/ignores.md)).

## What you own

Running this yourself moves five responsibilities onto you. This is the list:

| | |
|---|---|
| **Compute** | Rendering happens on your machines. It can be a pinned runner elsewhere — a document acquired in a unit test renders remotely and byte-identically — but nobody supplies it |
| **Storage** | A directory, git-LFS, a service you run, or nothing at all under ephemeral retention. Where a baseline lives changes no verdict, so the rung is climbable later |
| **Mounting** | The collector is the half this project declines to write, because mounting *your* components needs your bundle, providers and definition of settled. Storybook, served URLs and Playwright suites have shipped surfaces; anything else is a module you write once |
| **The gate** | The exit code is the interface, so any CI that runs a command has it. Delivering a pull-request comment is your workflow and your token |
| **Comparability** | Machine-bound artifacts are confined to the raster tier and keyed by renderer identity. Two identities are `incomparable`, never `different` |

## How it is put together

Tools, not a pipeline: order is the caller's, and every value that crosses a
seam is serializable, which is what lets any hop become a network hop
([`docs/architecture.md`](docs/architecture.md)).

Decisions are made at the cheapest representation that can make them —
reachability, then a structure and CSS digest, then semantics under `jsdom`,
then semantics under `chromium`, then pixels. Two observation profiles feed
that ladder and are never compared against each other; a band a profile cannot
observe reports `unobserved` rather than passing
([ADR-0002](docs/context/adr/0002-observation-profiles.md)).

**A package is named for what it needs, not for what it does**
([ADR-0013](docs/context/adr/0013-packages-are-named-for-their-requirements.md)),
so the cost of a capability is legible before you install it. Adopter-facing
code names one package
([ADR-0024](docs/context/adr/0024-a-consumer-knows-one-package.md)).

*Require nothing* — [`core`](packages/core), the format, rules, comparison,
attribution and verdicts · [`raster`](packages/raster), the pixel tier as data ·
[`report`](packages/report) · [`history`](packages/history) ·
[`storybook`](packages/storybook), a story index as a subject list.

*Require something, and say so* — [`dom`](packages/dom) and
[`session`](packages/session) need a live DOM · [`react`](packages/react) needs
React internals · [`playwright`](packages/playwright) needs a browser ·
[`png`](packages/png) and [`png-sharp`](packages/png-sharp) need a codec, the
second a native one · [`store`](packages/store) needs a filesystem ·
[`remote`](packages/remote) a socket · [`server`](packages/server) a database ·
[`mcp`](packages/mcp) stdio · [`tribunal`](packages/tribunal) a deployment.

*Compose the above* — [`cli`](packages/cli) is the workflow and the binary ·
[`observe`](packages/observe) is the whole answer without a config file ·
[`storybook-collector`](packages/storybook-collector),
[`route-collector`](packages/route-collector) and
[`playwright-test`](packages/playwright-test) are the three adoption surfaces.

Every package README states its requirement and what its entrypoints cost.
Dependencies point downward only, and `tools/boundaries.check.ts` fails the
build when they do not.

## Routes

| If your task is | Start at |
|---|---|
| Asking whether this replaces what you pay for | [`docs/gates.md`](docs/gates.md) — three scorecards, and the rows that say no |
| Weighing a move from a hosted product | [`docs/replacing.md`](docs/replacing.md) for what the move involves, then [`docs/cases.md`](docs/cases.md) for which decision each product is welded to, and where this one is welded too |
| Checking the head-to-head yourself | [`cases/incumbent-case`](cases/incumbent-case) — a real `playwright test` and a real `toHaveScreenshot` over the same page, eight edits declared before either arm ran |
| Getting your suite in | [`docs/surface.md`](docs/surface.md) — what you write and install, by suite |
| Choosing where baselines live | [`docs/flows.md`](docs/flows.md) — six setups and what each cannot do |
| Silencing a clock, a carousel or a flake | [`docs/ignores.md`](docs/ignores.md) — the two forms, a case each, and the ledger that stops one becoming a blind spot |
| Catching what the document never said | [`docs/framework.md`](docs/framework.md) — the fiber as a dimension: a `wiring` band that separates two byte-identical components, and the remount that quietly reset your user's state |
| Connecting two examples that share a component | [`docs/composition.md`](docs/composition.md) — the suite compared to itself at one commit: which examples watch the same bytes, which layer each is an example of, and why each component moved |
| Catching what no single run can | [`docs/history.md`](docs/history.md) — drift across approvals, how often a component changes, whether a flake is new |
| Running less of the suite per pull request | [`docs/selecting.md`](docs/selecting.md) — `--since`, what it will not skip, and what it cannot reach |
| Running the binary in CI | [`cli`](packages/cli) — six commands, exit codes, sharding, the HTML report, CI recipes |
| Composing it as a library | [`observe`](packages/observe) for the assembled answer, [`core`](packages/core) for the pieces |
| Serving a coding agent | [`mcp`](packages/mcp) — the observation over stdio |
| Working on this repository | [`docs/context/README.md`](docs/context/README.md) for the paper trail, [`docs/specs/`](docs/specs/README.md) for what is unfinished |

Deeper still: [`docs/comparison.md`](docs/comparison.md) surveys four established
products and names what each of them does better;
[`docs/metrics.md`](docs/metrics.md) states what would settle those
disagreements with a number;
[`docs/context/checkpoint.md`](docs/context/checkpoint.md) is current state;
[`docs/context/adr/`](docs/context/adr/) holds the decisions that constrain the
code and [`docs/context/journal/`](docs/context/journal/) what each attempt cost.

## Development

Node 22 and Yarn 4 through corepack.

```bash
yarn install
yarn build && yarn verify
```

`verify` is lint, the documentation and boundary checks, and the tests. Browser
suites skip themselves with a reason when no Chromium is present:

```bash
npx playwright install chromium
```

The two corpus measurements quoted above — 38/38 under `jsdom`, then 39/39 under
`chromium`:

```bash
yarn vitest run examples/kitchen-sink/src/measure.test.tsx
yarn vitest run examples/kitchen-sink/src/measure.chromium.test.tsx
```

## Licence

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Mechanic Garden.
