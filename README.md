# Variance Authority

> Percy shows you pixels. Variance Authority tells you `Button` broke the hero.

A deterministic verification layer for frontend surfaces. A run mounts a
project's own components, decides what it can from the document, renders only
what is left, and resolves whatever changed to a component and a `file:line`.
Everything happens in the operator's infrastructure: no hosted service, no
telemetry, no network egress except a renderer the operator runs.

The unit of review is a document, not an image. That is what lets a run answer
questions a comparison cannot reach — which control lost its accessible name,
which string nobody translated — and what lets a changed pixel resolve to the
component that produced it.

**Status: M0 spike**, the milestone that asked whether normalization quality was
achievable. The pipeline runs end to end under both observation profiles and
scores 38/38 under `jsdom` and 39/39 under `chromium`, with zero false verdicts
in either direction, against [one corpus](examples/kitchen-sink) whose ground
truth was declared before the run.

Obtaining it is a clone until the first release lands
([spec 0015](docs/specs/0015-the-first-published-release.md)). What is left to
build is [`ls docs/specs/`](docs/specs/README.md) — a directory whose entry
criterion is that everything in it is unfinished, and whose files are deleted the
day the capability ships.

---

## What a run reports

A comparison stops at a mask rather than a number. The mask clusters into
regions, the regions join the box tree, the tree knows which component produced
each node, and the component resolves to a file:

```
--- broken-toggle on page/todos--populated
what a pixel differ reports:  1530 pixels changed
what this reports:            5 region(s)
  cause       933px in 2 region(s) — Text     src/ds/components.tsx:42
  cause        86px in 2 region(s) — Toggle   src/ds/components.tsx:107
                in checkbox "Mark "Prove the tiering" as done"
  collateral  511px in 1 region(s) — Stack    src/ds/components.tsx:27
```

The split in the first column carries as much as the file in the third. Ranked
by area, that report is inverted: `Stack` was never edited, only reflowed, and it
outranks the edit by 6×. Area measures displacement, so the ordering has to come
from the tier that holds provenance.

Separating cause from collateral costs two documents, so it runs wherever both
are in hand — the block above comes from
[`examples/todomvc/src/observe.chromium.test.ts`](examples/todomvc/src/observe.chromium.test.ts),
which composes [`core`](packages/core) directly. Reaching the same ordering from
a stored baseline is
[spec 0017](docs/specs/0017-cause-first-ranking-on-every-path.md).

Two further findings need no baseline at all. Each render is read on its own for
nine kinds of accessibility defect — a control with no accessible name, an image
with no `alt`, a heading level skipped, a control inside a control, and five more
— each naming a component and a file. A button that never had an accessible name
compares equal to itself on every run there will ever be, so approving the first
baseline approves the defect. Across two locales, a run reports which string is
identical where others moved and which box stopped fitting its container.
Neither changes the verdict: a tool that blocks a merge on day one over findings
nobody asked for is switched off in week one. Both are facts about a document, so
both cost no screenshot.

## How it decides

Five tiers, each settling what it can and passing the rest on:

```
reachability → structure+CSS digest → jsdom semantic → chromium semantic → raster
   free              ~ms                   ~ms              7.5 ms          ~s
```

Two observation profiles feed them, and they are never compared against each
other:

| Profile | Driver | Observes |
|---|---|---|
| `jsdom` | jest, vitest | structure, ARIA, declared CSS — **no layout** |
| `chromium` | playwright, agent-browser | the above **+ computed style + layout rects + raster** |

The profile is part of the environment key, so a band a profile cannot observe
reports `unobserved` rather than passing. `jsdom` is not a cheap browser; it is
an earlier gate that settles the token band and structural geometry in
milliseconds, inside the unit-test process
([ADR-0002](docs/context/adr/0002-observation-profiles.md)).

Refusal is the technique the whole design rests on. Two results whose identities
differ are `incomparable`, never `different`, because a difference in conditions
reported as a difference in the product is a confident wrong answer. Not
measured, measured as zero, and unobservable stay three distinct states;
collapsing any two produces a pass nobody earned.

## What it costs

The architecture is organised around not reaching the expensive tier.

| Mechanism | Measured |
|---|---|
| Cruft removal before anything is compared | **1007 CSS rules parsed → 1 reached the normalizer** |
| One browser, one page, one navigation per run | **7.5 ms/capture warm vs 205 ms cold — 27×** |
| Deciding semantically before rendering | **3.4 ms** semantic collection vs **65.4 ms** for a screenshot |
| One standing world instead of rinsing between subjects | **3.1×–3.9×** across runs, probe overhead **~2%** |
| Content-addressed render cache | an unchanged document under an unchanged identity is not re-rendered |
| Settling from the sidecar | and not re-read: a durable run where nothing moved decodes no baseline image, because the digest that settles it is a few hundred bytes of text beside the PNG rather than inside it |
| Ephemeral retention | both images rendered in the same run by one renderer, so the machine cancels out by construction — no container, no pinned runner, no stored artifact |

The last row is the one that distinguishes the approach. Stabilising pixels
elsewhere means pinning the whole pipeline everywhere; here the machine-bound
artifact is confined to the tier that actually has one, and one retention mode
has no stored artifact at all
([ADR-0011](docs/context/adr/0011-durable-and-ephemeral-retention.md)).

## Variance, and what absorbs it

Rendering varies. The usual treatment is a retry count and a pixel tolerance,
which trade a false alarm for a missed regression at a rate nobody measures. The
treatment here is a taxonomy rather than a threshold: each cause is absorbed by
the cheapest mechanism that can absorb it. Some causes never reach the
representation. Some are two baselines compared under different identities, and
are refused rather than diffed. Some are one policy decision. Some are real
changes that look like noise.

The false-miss rate against the corpus is 0/20. Sizing the opposite rate against
a library nobody here wrote is
[spec 0022](docs/specs/0022-evidence-from-code-this-project-did-not-write.md).

**→ [`docs/flakiness.md`](docs/flakiness.md)** — the eleven causes, what absorbs
each, and the five rows where this loses.

## Measured against a Playwright incumbent

`@playwright/test` is installed in [`cases/incumbent-case`](cases/incumbent-case);
its own runner executes its own `toHaveScreenshot` in its own process, over the
same page and the same clip. Eight edits, each declared with its argument before
either arm ran, scored against whether a reviewer must be told rather than
whether the image changed. `hit` and `miss` are against that question, `hold` is
a silent pass on a subject with no defect, and `deferral` is a subject with no
baseline to compare against:

```
scenario            ground truth  incumbent (defaults)  incumbent (tolerant)  variance     names (first two)
label-dropped       regression    miss                  miss                  hit          IconButton
heading-demoted     regression    miss                  miss                  hit          Heading
control-devolved    regression    miss                  miss                  hit          RowAction
indicator-dropped   regression    hit                   miss                  hit          Indicator
space-token-nudged  regression    hit                   hit                   hit          Panel, Toolbar
row-added           regression    hit                   hit                   hit          Total, Panel
unseen-subject      no defect     deferral              deferral              deferral     no baseline
note-reindented     no defect     hold                  hold                  false alarm  Note
```

**A category no threshold reaches.** The first three rows are missed at every
configuration the incumbent has. An `aria-label` deleted, a heading demoted, a
`<button>` devolved to a `<div>` — none reach a pixel, so a comparator has
nothing to find. All three settle here with no image consulted on either side.
That is a property of comparing images rather than of any product, so it holds
against every raster tool in the category.

**A tolerance is measured against the wrong quantity.** `maxDiffPixelRatio: 0.01`
of a 420×312 clip is **1310px** of licence; the status indicator that vanished is
**36px**. The regression fits 36 times inside the setting that makes the suite
survivable, and nothing in the output distinguishes which of the two it absorbed.

**The eighth row is where this arm scores worst, and the corpus asserts it.** A
reindented block renders identically and still moves the structural hash, so the
scenario is declared a false alarm and the suite goes red the day it stops being
one. Sizing that class of alarm is
[spec 0022](docs/specs/0022-evidence-from-code-this-project-did-not-write.md).

**→ [`docs/replacing.md`](docs/replacing.md)** — what moving off four incumbents
costs and buys ·
**[`docs/comparison.md`](docs/comparison.md)** — where each competitor wins, and
[ten conditions](docs/comparison.md#5-when-not-to-choose-this) under which one of
them is the better answer.

## Running it

A run happens inside a clone, over a project vendored beside it, until the first
release lands ([spec 0015](docs/specs/0015-the-first-published-release.md)).
Node 22 and Yarn 4 through corepack:

```bash
git clone https://github.com/Variance-Authority/variance-authority.git
cd variance-authority && corepack enable && yarn install && yarn build
npx playwright install chromium
```

A run takes a config file and a collector. Nothing is discovered, registered or
scanned for, and nothing is downloaded, so a run's inputs are the ones in the
repository:

```jsonc
// variance.config.json
{
  "project": "acme",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": {
    "kind": "storybook",
    "index": "storybook-static/index.json",
    "collector": "variance/collector.mjs"
  },
  "baselines": { "kind": "directory", "root": "baselines" },
  "report": ".variance/report.json"
}
```

The collector is the half of a run this project declines to write: mounting a
project's components needs its bundle, its providers and its own definition of
settled. For a built Storybook that is five lines, because
[`storybook-collector`](packages/storybook-collector) owns the generic part —
serving the build, driving the preview channel, and acquiring the document and
the capture from one mount:

```js
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  ready: { 'panel--async': '[data-testid="loaded"]' },
  source: { dirs: ['src'] },
});
```

What remains is what only the project knows: which story defers its own readiness
and by what marker, and where its components live. A set of served URLs is the
same shape through [`route-collector`](packages/route-collector), and a
Playwright suite needs no collector at all — its test body already is one. Any
other subject source is a module the adopter writes, once. Component attribution
also needs a build that preserves function names: a minified Storybook reports
`a` instead of `Button`.

The cycle, driven from a clone:

```bash
node packages/cli/dist/bin.js run
node packages/cli/dist/bin.js accept --all
```

The exit code is the interface — `0` nothing needs review, `1` changes need
review, `2` operator error — so a first run is red by design. A verdict and a
crash never share a code, because a red build that could mean either "a component
changed" or "the store was unreachable" is a red build nobody investigates
([ADR-0017](docs/context/adr/0017-the-exit-code-is-the-interface.md)). Measured
over a Storybook this project did not write
([`cases/storybook-case`](cases/storybook-case), eight stories, one component
edited):

| step | verdicts | exit |
|---|---|---|
| `run` on a fresh checkout | 8 new | **1** |
| `accept --all` | 8 accepted | 0 |
| `run` again | 8 unchanged, nothing to review | 0 |
| `run` on the changed build | 3 unchanged, **5 changed** | **1** |

`Button` appears in five of those eight stories, and the run finds exactly those
five.

Name subjects explicitly — `variance accept story:card--populated …` — anywhere a
first baseline and a changed one need different answers, and keep `--all` to
runs a person is watching. Teaching the command that difference itself is
[spec 0023](docs/specs/0023-accept-tells-new-from-changed.md).

**→ [`cli`](packages/cli)** — the six commands, sharding across CI jobs, the
single-file HTML report, and the CI recipes.

## Where things are kept, and who runs them

| | | |
|---|---|---|
| **Subjects** | Come from an existing suite — jest, vitest, Storybook, Playwright. Both profiles emit one snapshot format, so a subject decided in a unit test today can be decided in a browser tomorrow without being written twice. There is no separate test format and no DSL | [`docs/surface.md`](docs/surface.md) |
| **Baselines** | git-LFS by default, because it needs no infrastructure and a baseline image is never hand-merged. Also a directory, a service the operator runs, or nothing at all under ephemeral retention. Where a baseline is kept decides nothing about the verdict | [`docs/flows.md`](docs/flows.md) |
| **The pipeline** | The operator, locally or in CI. Node and Playwright, no daemon and no service dependency, so a CI that can run a command already has the gate, and the exit code is what it gates on | [`cli`](packages/cli#bitbucket-pipelines-and-what-carries-to-any-ci) |
| **Rendering** | Wherever the operator points it. Acquisition, assembly, rendering, comparison, isolation and attribution are six independent phases and only two need a browser, so a document acquired in a unit test can be rendered by a pinned machine elsewhere, byte-identically | [`remote`](packages/remote) |
| **Data** | In the operator's infrastructure, in full. [`core`](packages/core) depends on nothing in this repository and on no host environment — no DOM, no Node, no globals — enforced by the compiler | [`docs/architecture.md`](docs/architecture.md) |

## Packages

**A package is named for what it needs, not for what it does.** Five need nothing
at all — no browser, no codec, no disk, no socket — which is why the cheap tiers
are cheap in practice and not only on paper.

**Requires nothing**

| | |
|---|---|
| [`core`](packages/core) | the format, the rules, comparison, attribution, verdicts, plans — six entrypoints |
| [`raster`](packages/raster) | the pixel tier as data: assembly, contracts, policies, interventions, the gate |
| [`report`](packages/report) | what a run leaves behind — one shape, several readers |
| [`history`](packages/history) | what a row may contain, what the numbers mean, what to say with no store |
| [`storybook`](packages/storybook) | a project's own stories as a subject list |

**Requires something, and says so in its name**

| | requires | |
|---|---|---|
| [`dom`](packages/dom) | a live DOM | extraction, CSS applicability pruning, and provenance from `data-*` for anything that is not React |
| [`react`](packages/react) | React internals | fibers → owner chains, props digests, portals |
| [`session`](packages/session) | a live DOM | many subjects in one standing world |
| [`playwright`](packages/playwright) | a browser | the persistent harness, and a renderer |
| [`png`](packages/png) | a PNG codec | decoding, comparison, the diff image |
| [`png-sharp`](packages/png-sharp) | a compiled native addon | the same comparison. Decoding is **90%** of one, at **15.0 ms** against `pngjs`'s 22.6 ms per image |
| [`store`](packages/store) | a filesystem | baselines on disk, and in git-LFS |
| [`remote`](packages/remote) | a socket | a renderer and a store across a hop |
| [`server`](packages/server) | a database | the history service the operator runs |
| [`tribunal`](packages/tribunal) | a deployment with a database and a bucket | baselines, history, and the review-and-approve surface, in an account the operator controls |
| [`mcp`](packages/mcp) | stdio | the observation, exposed to an agent |

**Composes the above**

| | |
|---|---|
| [`observe`](packages/observe) | two images to a verdict, in either retention mode — the whole answer without the CLI's config file, and the only place in the repository where a phase order is hard-wired |
| [`playwright-test`](packages/playwright-test) | one fixture and one matcher, for a suite whose test body already is the collector |
| [`storybook-collector`](packages/storybook-collector) | the mounting half for a built or served Storybook, so an adopter writes five lines instead of 341 |
| [`route-collector`](packages/route-collector) | a map of served URLs to subjects |
| [`cli`](packages/cli) | the workflow, which is the one place a workflow belongs |

Beside them: [`examples/kitchen-sink`](examples/kitchen-sink), 8 subjects and 40
declared cases, which is the measurement's ground truth;
[`examples/todomvc`](examples/todomvc), a small design system and the pixel arm;
[`cases/`](cases), confrontations with software this project did not write; and
[`docs/context/`](docs/context), the paper trail of decisions, attempts and
current state.

Dependencies point downward only, and collectors extract while `core` normalizes.
That split is what makes one ruleset serve both profiles by construction, and
what lets a capture cross a network hop unchanged. `tribunal` is the deliberate
exception to the naming rule: it is a service rather than a linked tool, so the
requirement it names is a deployment
([ADR-0023](docs/context/adr/0023-a-service-is-named-for-what-it-is.md)).

The layout is a test rather than a convention
([ADR-0013](docs/context/adr/0013-packages-are-named-for-their-requirements.md),
[ADR-0024](docs/context/adr/0024-a-consumer-knows-one-package.md)):
`tools/boundaries.check.ts` fails when an import goes undeclared, when
adopter-facing code names a second package, or when an advertised entrypoint
stops resolving. The documentation is a test too
([ADR-0014](docs/context/adr/0014-examples-are-call-sites.md)):
`tools/docs-links.check.ts` and `tools/docs-claims.check.ts` resolve every link,
repository path and `file:line` reference across all
95 markdown files, and every README example is compiled against the built types.
An example
is a call site the compiler could not see, which is how 11 of the 20 that existed
when the check first ran turned out to be stale against APIs renamed underneath
them.

## What is left to build

`ls docs/specs/` — and that is the whole answer, because a spec here exists only
while its capability is unfinished and is deleted the day it ships. The
[index](docs/specs/README.md) states what each one is missing and what would
discharge it, in dependency order. Decisions that survive a spec move into
[`docs/context/adr/`](docs/context/adr/); what each attempt cost is in
[`docs/context/journal/`](docs/context/journal/); current state is
[`docs/context/checkpoint.md`](docs/context/checkpoint.md).

## Reading order

1. [`docs/architecture.md`](docs/architecture.md) — the composition model: tools,
   their contracts, and why there is no pipeline
2. [`docs/surface.md`](docs/surface.md) — what an adopter writes and installs, by
   suite: Storybook, Playwright, jest/vitest, anything
3. [`docs/flows.md`](docs/flows.md) — six setups, from ephemeral to a review
   service, and what each one cannot do
4. [`docs/comparison.md`](docs/comparison.md) — where each competitor wins, and
   when not to choose this
5. [`docs/replacing.md`](docs/replacing.md) — four things teams already run, and
   what moving costs
6. [`docs/cases.md`](docs/cases.md) — the six coins every tool in this category
   has already called, and which face each one landed on
7. [`docs/flakiness.md`](docs/flakiness.md) — the position on variance
8. [`docs/metrics.md`](docs/metrics.md) — what would settle the disagreements
   with a number
9. [`docs/specs/`](docs/specs/README.md) — what is decided and not yet built, in
   dependency order
10. [`docs/context/README.md`](docs/context/README.md) — how the paper trail
    works: [`checkpoint.md`](docs/context/checkpoint.md) for current state,
    [`adr/`](docs/context/adr/) for the decisions that constrain the code
    ([0003](docs/context/adr/0003-cruft-removal-and-css-applicability.md) is the
    moat), [`journal/`](docs/context/journal/) for what each attempt cost

## Development

```bash
yarn install
```

```bash
yarn build && yarn verify
```

`verify` is lint, the documentation and boundary checks, and the test suite. The
M0 measurement, which scores the pipeline against the corpus:

```bash
yarn vitest run examples/kitchen-sink/src/measure.test.tsx
```

The `chromium` half needs a browser, and skips itself with a reason when there is
none:

```bash
npx playwright install chromium
```

```bash
yarn vitest run examples/kitchen-sink/src/measure.chromium.test.tsx
```

Pixels to code lines, end to end:

```bash
yarn vitest run examples/todomvc/src/observe.chromium.test.ts
```

What the persistent harness is worth, cold against warm:

```bash
yarn workspace @variance-authority/example-kitchen-sink bench
```

## Licence

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Mechanic Garden.
