# Variance Authority

A deterministic verification layer for frontend surfaces, distributed as a
TypeScript library and a `variance` binary. It is not a service: there is no
account, no dashboard, and nothing to send a build to. You run it in your own
CI, against your own components, and it exits `0`, `1` or `2`.

The unit of review is the **document** a component rendered, not the image. A
run acquires markup plus the CSS that applies to it, settles what the document
alone can settle, renders only what is left, and resolves a change to the
component that caused it and the file it lives in. That representation is why a
run can also report defects no comparison reaches — a control that never had an
accessible name, a string nobody translated — and why most subjects never cost a
screenshot.

If you already operate Argos, Chromatic or Percy, the material differences are
in [scope and non-goals](#scope-and-non-goals) and
[what you own](#what-you-own). [`docs/replacing.md`](docs/replacing.md) covers
what moving actually costs, and
[`docs/comparison.md`](docs/comparison.md#5-when-not-to-choose-this) lists ten
conditions under which one of those products is the better answer.

**Maturity and distribution.** One milestone is complete: the pipeline runs end
to end under both observation profiles and scores 38/38 and 39/39 against a
corpus whose ground truth was declared before the run. The packages are MIT and
publishable, and distribution is from source until the first release
([spec 0015](docs/specs/0015-the-first-published-release.md)). What is unfinished
is [`docs/specs/`](docs/specs/README.md), a directory whose entry criterion is
that everything in it is incomplete.

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
  matrix, mobile and real devices are out.
- **No retries and no tolerances.** A subject that will not hold still is
  reported, not re-observed — [`docs/flakiness.md`](docs/flakiness.md) is the
  position and the five cases where it loses. What you *can* say is that a
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
| Weighing a move from a hosted product | [`docs/replacing.md`](docs/replacing.md) for what the move involves, then [`docs/cases.md`](docs/cases.md) for what a measurement alongside a real `toHaveScreenshot` run found |
| Getting your suite in | [`docs/surface.md`](docs/surface.md) — what you write and install, by suite |
| Choosing where baselines live | [`docs/flows.md`](docs/flows.md) — six setups and what each cannot do |
| Silencing a clock, a carousel or a flake | [`docs/ignores.md`](docs/ignores.md) — the two forms, a case each, and the ledger that stops one becoming a blind spot |
| Catching what no single comparison can | [`docs/history.md`](docs/history.md) — drift across approvals, how often a component changes, whether a flake is new |
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

The corpus measurement quoted at the top of this file:

```bash
yarn vitest run examples/kitchen-sink/src/measure.chromium.test.tsx
```

## Licence

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Mechanic Garden.
