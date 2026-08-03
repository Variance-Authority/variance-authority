# Variance Authority

> Percy shows you pixels. Variance Authority tells you `Button` broke the hero.

A deterministic verification layer for frontend surfaces, built for agent-driven
development. It answers *"what changed, why, where, and should anyone care?"* at
the cheapest representation capable of deciding — in your own infrastructure.

**Status: M0 spike.** The pipeline runs end to end under **both** profiles and is
measured against a corpus with pre-declared ground truth — 38/38 under `jsdom`,
39/39 under `chromium`, zero false verdicts either way. Above the semantic tiers
sits a raster tier that resolves changed pixels to components; baselines are kept
either **durably**, addressed by renderer identity, or **ephemerally**, with both
images rendered by one renderer in the same run and nothing stored; and an MCP
surface hands the whole observation to an agent. `variance run` completes over a
real Storybook — *new → accept → unchanged → 5 of 8 changed on a one-component
edit* ([journal 0014](docs/context/journal/0014-the-incumbent.md)). A run also
reports what no comparison can reach: accessibility defects present on the first
run, and, across two locales, which string nobody translated and which box
stopped fitting ([journal 0015](docs/context/journal/0015-without-a-baseline.md)).
A review surface with an approval workflow now exists too — builds, a docket
ranked by cause, and an approval that promotes the candidate the run already
produced — served from an operator's own Cloudflare account and **never once
deployed to one**. Nothing is published and there is no hosted anything. Read
[what does not exist yet](#what-does-not-exist-yet) before believing any of the
rest.

---

## Questions people actually ask

### "VR is flaky."

Yes. Visual regression demands careful handling and a total understanding of what
causes variance and why — and most tools answer it with retries and tolerances,
which trade a false alarm for a missed regression at a rate nobody measures.

Our position is that **"is it flaky" is the wrong question**. The right one is
*what would it take to absorb this?*, and the answers are not interchangeable:
some causes cannot reach the representation at all, some are two different
baselines compared by mistake, some need one policy decision, and some are real
changes wearing a flake costume.

**→ [Our vision on flakiness](docs/flakiness.md)** — the full taxonomy, what
absorbs each cause, what we measured, and the four rows where we lose.

### "VR is expensive."

Also yes. Normal VR costs far more than unit or integration testing, and there
are real reasons for that — it renders, it stores, it compares images, and it
usually pins an entire container to make any of that reproducible.

And it is not only the direct cost. **It is the time.** Nobody enjoys watching
every other check go green while VR keeps grinding away for no apparent reason.

So the architecture is organised around not doing the expensive thing:

| What | Measured |
|---|---|
| Cruft removal before anything is compared | **1007 CSS rules parsed → 1 reached the normalizer** |
| One browser, one page, one navigation per run | **7.5 ms/capture warm vs 205 ms cold — 27×** |
| One standing world instead of rinsing between subjects | **3.4× faster**, probe overhead **~2%** of session time |
| Deciding semantically before rendering | **3.4 ms** semantic collection vs **65.4 ms** for a screenshot |
| Content-addressed render cache | an unchanged document under an unchanged identity is **not re-rendered** |
| Ephemeral mode | both images rendered now by one renderer, so the machine cancels out **by construction** — no container, no pinned runner, no stored artifact |

The last row matters most. Everyone else stabilises pixels by pinning the whole
pipeline everywhere; we confine the machine-bound artifact to the tier that
actually has one, and offer a mode with no stored artifact at all.

### "Yeah, for *no reason*. VR is a trivially simple signal to generate — so it provides no value."

Absolutely right about the first half. Everybody develops review blindness in a
blink: the hundredth screenshot in a run gets the same glance as the first, and
the three-hundred-and-first is approved without being read.

That is exactly what we approach differently, in two ways.

**Connecting pixels to code lines.** *(built and measured — see the limit below
the block)* A comparison stops at a mask rather than a number; the mask clusters
into regions; regions join the box tree; the tree knows which component produced
each node; the component resolves to a file:

```
--- broken-toggle on page/todos--populated
what a pixel differ reports:  1530 pixels changed
what this reports:            5 region(s)
  cause       933px in 2 region(s) — Text     src/ds/components.tsx:42
  cause        86px in 2 region(s) — Toggle   src/ds/components.tsx:107
                in checkbox "Mark "Prove the tiering" as done"
  collateral  511px in 1 region(s) — Stack    src/ds/components.tsx:27
```

The third column is the point. Ranked by area that report is *wrong* — `Stack`
was never edited, only reflowed, and it outranks the edit by 6×. Area measures
displacement, so the ordering comes from the tier that has provenance.

**Which surface emits it.** That block comes from
[`examples/todomvc/src/observe.chromium.test.ts`](examples/todomvc/src/observe.chromium.test.ts),
composing [`core`](packages/core) directly: `diffSnapshots` over *two* documents
names the causes, then `isolateRegions` → `attributeRegions` → `rankRegions` orders
them. **Two documents are what the `cause`/`collateral` split costs.** `variance
run` has the same wiring and ranks by cause whenever it is handed one — but on the
durable path the baseline is an image with no document behind it, so it is handed
none and the ordering falls back to area, which this block just called wrong.
`observePair` does not rank at all: it renders both images but carries a single
snapshot, so it attributes and stops. Component and file survive in every case;
only the ordering does not. See
[what does not exist yet](#what-does-not-exist-yet).

**Tracking accumulated change over time.** *(designed, not built — see
[spec 0002](docs/specs/0002-history-store.md))* A button gains 2px,
eleven times, each approved correctly, and nobody ever sees the 22px change. No
threshold catches that, because the quantity that would have is a **sum** and
nothing in a one-run-at-a-time tool is summing. What gets recorded is one content
hash per band per component boundary plus the resolved token values — never
pixels, never images, never coordinates — so `--va-space-3: 12px → 20px across
eight approvals` becomes an exact, machine-independent sentence.

> Between them: a change you can hand to whoever owns the file, and a change too
> small to notice that still gets counted.

### "We already have Playwright screenshots. Why would we switch?"

**Mostly you would not switch — you would keep the runner and replace what
happens after the screenshot.** We use Playwright ourselves.

So the question is answered by running theirs. `@playwright/test` is installed in
[`cases/incumbent-case`](cases/incumbent-case), its own runner executes its own
`toHaveScreenshot` in its own process, over the same page and the same clip we
read. Eight edits, each declared with its argument *before* either arm ran, scored
against *must a reviewer be told?* rather than *did the image change*:

```
scenario            ground truth  incumbent (defaults)  incumbent (tolerant)  ours         and we name
label-dropped       regression    miss                  miss                  hit          IconButton
heading-demoted     regression    miss                  miss                  hit          Heading
control-devolved    regression    miss                  miss                  hit          RowAction
indicator-dropped   regression    hit                   miss                  hit          Indicator
space-token-nudged  regression    hit                   hit                   hit          Panel, Toolbar
row-added           regression    hit                   hit                   hit          Total, Panel
unseen-subject      no defect     deferral              deferral              deferral     no baseline
note-reindented     no defect     hold                  hold                  false alarm  Note
```

Three things that table is for:

**A category no threshold reaches.** The first three rows are missed at *every*
configuration the incumbent has. An `aria-label` deleted, a heading demoted, a
`<button>` devolved to a `<div>` — none reach a pixel, so there is nothing for a
comparator to find. We settle all three with **no image consulted on either
side**. This is a property of comparing images rather than of any product, so it
holds against every raster tool on the market.

**A tolerance is measured against the wrong thing.** `maxDiffPixelRatio: 0.01` of
a 420×312 clip is **1310px** of licence; the status indicator that vanished is
**36px**. The regression fits 36 times inside the setting that makes the suite
survivable — and nothing in the output says which of the two it just absorbed.

**We lose a row, and it is in the table.** A reindented block renders identically
and moves our hash. It is asserted as a false alarm, so the day somebody fixes it
the suite goes red.

**Leaving is cheap; leaving cleanly is a generation.** Their baselines are
ordinary PNGs, so the reading end answers from them with components and files on
the first run, with nothing re-recorded. What a PNG cannot carry is an identity —
so `incomparable` is unavailable — or a document, so ranking falls back to area,
which we measured as backwards. Import to get moving, re-record as you go.

**What this does not cover:** the hosted products are half comparison and half
product. Of the product half, a review UI and a team approval workflow now exist
as code — [`@variance-authority/cloudflare`](packages/cloudflare), the operator's
own D1 and R2, [ADR-0021](docs/context/adr/0021-approval-promotes-an-image-that-already-exists.md) — and
**have never been deployed to Cloudflare**. A cross-browser grid and change
detection at repository scale are not confronted at all.
[`cases/README.md`](cases/README.md) says so at more length.

---

### "What can you tell me that a screenshot cannot?"

Two things, and neither is a better comparison.

**A defect that was there on the first run.** A button that never had an
accessible name compares equal to itself on every run there will ever be, so
approving the first baseline approves the defect. `variance run` reads each
render on its own and reports nine kinds of defect in it — a control with no
accessible name, an image with no `alt`, a heading level skipped, a control
inside a control, a reference pointing at nothing, an accessible name that does
not contain its own visible label, two landmarks of one role that nothing tells
apart, a table with no header cells, a positive `tabindex` — each naming a
component and a file. They never change the verdict; a tool that blocks a merge
on day one over findings nobody asked for gets switched off in week one.

**Which string nobody translated.** A message catalogue and a PNG have no key in
common, so the category's answer to a localized UI is N times as many screenshots
and a person to look at all of them. Comparing one subject across two languages
is arithmetic here: a string identical in both where others moved, and a box that
fitted its container in one language and does not in the other. Measured on one
panel in English and German against real Chromium layout — 16 strings translated,
one left behind, 2 boxes overflowing at a 300px width and none at 420px.

*Both are facts about a document, so they cost no screenshot. Neither has been
run against an application anybody else wrote.*

### "Where do test cases come from?"

**From you.** Jest, Vitest, Storybook, Playwright — you choose. There is no
separate test format to author and no DSL to learn; a subject is whatever your
existing suite already mounts.

Both rendering surfaces emit the same snapshot format and enter the same
normalizer, so a subject can be decided in a unit test today and in a browser
tomorrow without being written twice.

*Built: Vitest/Jest via `jsdom`, and Playwright. `variance run` drives a real
Storybook end to end through a collector the operator writes — a few hundred
lines, once, per project. There is no plugin.*

### "Where are results stored?"

**Git-LFS, like Percy — or your own server, like Chromatic or Argos. You choose.**
Git-LFS is the default because it needs no infrastructure, and because a baseline
image is never hand-merged: you take one side.

History is a different artifact with different rules — see the next question.

*Built: a local directory partitioned by renderer identity, a git-LFS store, and
a remote store, all three producing identical verdicts on the same four
scenarios. Never exercised: git-LFS as git-LFS — no clean/smudge filter has run
and no image has been committed through it.*

### "Who runs the backend?"

**You do. And the backend is optional — git-LFS is the default.**

The backend is part of this project and runs in your own infrastructure: a
process, a port, and a token you set. Nothing is shared with anyone and nothing
is operated on your behalf.

Without a backend you get every single-run answer: what changed, which component,
which file. With one you additionally get history — when an area last changed, how
often it churns, what a token's value has drifted to across approvals.

When there is no backend the tool **says so** rather than reporting no drift. An
agent told "no drift" concludes the product is stable; what actually happened is
that nobody was keeping a record.

History cannot be a local file, and that is a settled decision rather than a
preference: a committed lock file puts derived state under human merge
resolution, and the hashes of a merge commit are neither branch's. A database has
no merge conflicts because it stores *observations*, not state. See
[spec 0002](docs/specs/0002-history-store.md).

*Built and unit-tested — the hashing, the drift arithmetic, the SQLite backend,
the HTTP surface, append-only enforced at the database level. **Never called from
a run**: `variance accept` explicitly refuses to record, so no row exists. This
is the largest gap in the project and it is the first entry under [what does not
exist yet](#what-does-not-exist-yet).*

### "Who runs the pipeline?"

**You do — locally, on pre-commit, or in CI. You configure it.** Nothing here
phones anything, schedules anything, or needs a hosted control plane to reach a
verdict.

*Built: `variance run`, `accept`, `report`, `serve`, `comment` and `doctor` — six
commands, driven end to end over a Storybook this project did not write. Never run
against a repository outside this one. `comment` renders the pull-request body and
posts nothing; sending it is the workflow's job, with your token.*

### "Who generates the images?"

**Your CI bot can, and commit them back to the PR with comments. Bring your own
workflow.** The pieces are deliberately separable — acquisition, assembly,
rendering, comparison, isolation and attribution are six independent phases, and
only two of them need a browser. A document acquired in a unit test can be
rendered by a pinned machine elsewhere, proven byte-identical in-process and over
an HTTP hop.

*Built: the phases, the remote renderer, the offload, and `variance comment`,
which renders the body. Also built, and off by default: the commit-back, which
refuses three ways — no baselines to commit, no head branch, or a workspace on a
detached merge ref. Written and never executed: the GitHub Action
([`.github/workflows/variance.yml`](.github/workflows/variance.yml)) that would
post any of it.*

### "Where does it work?"

**Any Linux terminal** — your dev machine, GitHub Actions, Bitbucket Pipelines.
It is Node and Playwright, with no service dependency and no daemon. The exit
code is the whole gate, so a CI that can run a command already has it; the only
platform-specific part is posting the comment, and both recipes are written down
([GitHub](.github/actions/variance),
[Bitbucket](packages/cli/README.md#bitbucket-pipelines-and-what-carries-to-any-ci)).

*Honest limit: every measurement in this repository was taken on one Mac with one
Chromium, and neither CI recipe has ever executed. Linux CI is the intended
target and is not yet verified —
[`docker/linux-verify.sh`](docker/linux-verify.sh) is the harness for it, and it
has not been run either.*

### "SOC 2?"

**Your data is your data.** Everything runs in your infrastructure. There is no
telemetry, no analytics, no phone-home, and no network egress other than a remote
renderer you run yourself. `core` depends on nothing in this repo and on no host
environment — no DOM, no Node, no globals — enforced by the compiler.

### "Where do you make money?"

**If you like Variance, let's talk** about custom-tailored solutions and premium
features. The core is meant to work without any of that.

---

## What exists

**A package is named for what it needs, not for what it does.** Five of them need
nothing at all — no browser, no codec, no disk, no socket — which is why the cheap
tiers are cheap in practice and not only on paper.

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
| [`store`](packages/store) | a filesystem | baselines on disk, and in git-LFS |
| [`remote`](packages/remote) | a socket | a renderer and a store across a hop |
| [`server`](packages/server) | a database | the history service you run |
| [`cloudflare`](packages/cloudflare) | your own D1 and R2 | baselines, history, and the review-and-approve surface, in an account you control. Never deployed |
| [`mcp`](packages/mcp) | stdio | the observation, exposed to an agent |

**Composes the above**

| | |
|---|---|
| [`observe`](packages/observe) | two images to a verdict — `observePair` and `observeAgainstBaseline`, the ephemeral and durable modes. Take it when you want the whole answer without the CLI's config file; it is the only place in the repository where a phase order is hard-wired |
| [`cli`](packages/cli) | the workflow, which is the one place a workflow belongs |

| | |
|---|---|
| [`examples/kitchen-sink`](examples/kitchen-sink) | 8 subjects, 40 declared cases — the measurement's ground truth |
| [`examples/todomvc`](examples/todomvc) | a small design system, the pixel arm, and the end-to-end |
| [`cases/`](cases) | confrontations with things we did not author — a real Storybook, a real `toHaveScreenshot` |
| [`docs/context/`](docs/context) | the paper trail: decisions that constrain the code, what each attempt cost, and current state — what is proven and what is open |

Every package has a README stating what it requires and what its entrypoints
cost.

Dependencies point downward only. Collectors extract; `core` normalizes. That
split is what makes one ruleset serve both profiles by construction, and what
lets a capture cross a network hop to a remote renderer unchanged.

The layout is a test rather than a convention — see
[ADR-0013](docs/context/adr/0013-packages-are-named-for-their-requirements.md)
and `tools/boundaries.test.ts`, which fails when an import goes undeclared, a
requirement gains a second owner, or an advertised entrypoint stops resolving.

**The documentation is a test too** —
[ADR-0014](docs/context/adr/0014-examples-are-call-sites.md) and
`tools/documentation.test.ts`, which resolves every link, every repository path
and every `file:line` reference in this and the other 71 markdown files, and
compiles every README example against the built types with no unused import. An
example is a call site the compiler could not see, which is why 11 of the 20 here
had gone stale against APIs that had been renamed underneath them. It runs in
`yarn typecheck` as well as `yarn test`.

## The two rendering surfaces

| Surface | Driver | Profile | Can observe |
|---|---|---|---|
| **JSDOM** | jest, vitest | `jsdom` | structure, ARIA, declared CSS — **no layout** |
| **REAL-DOM** | playwright, agent-browser | `chromium` | the above **+ computed style + layout rects + raster** |

They are never compared: the profile is part of the environment key, and a band a
profile cannot observe reports `unobserved` rather than passing. JSDOM is not a
cheap browser — it is an earlier gate that settles the token band and structural
geometry in milliseconds, in the unit-test process.

See [ADR-0002](docs/context/adr/0002-observation-profiles.md).

## The tier ladder

```
reachability → structure+CSS digest → jsdom semantic → chromium semantic → raster
   free              ~ms                   ~ms              7.5 ms          ~s
```

Each rung decides what it can and passes the rest on. The `chromium` rung costs
7.5 ms per subject only because the browser, the page and the navigation are
shared across a run; relaunching per subject costs 205 ms, **27× more** — see
[journal 0007](docs/context/journal/0007-persistent-harness-and-p4.md).

## What does not exist yet

- **A history with a row in it.** The drift arithmetic, the store and the service
  are written and unit-tested; **nothing has ever called them from a run.**
  `variance accept` explicitly refuses to record. So the 22px story above has
  never once been produced by the pipeline, which is the largest gap in the
  project. Per-component band hashing, which every history question is asked
  against, *is* written and corpus-scored
  ([ADR-0018](docs/context/adr/0018-a-component-hash-covers-its-own-nodes.md));
  nothing calls it from a run.
- **A GitHub Action, PR comments, commit-back.** The workflow and the composite
  action are committed and have never run once. The body they would post is
  `variance comment`, which has been run against a real report and never from
  CI — so what is unexercised is the delivery, not the docket. The CLI itself
  does now run — see [`cases/storybook-case`](cases/storybook-case) — but only
  against a project in this repository, and the mounting half of a run is a
  collector each adopter writes.
- **Cause-vs-collateral ranking on the durable path.** It needs the previous
  revision's snapshot and a stored baseline is an image, so `variance run` passes
  no causes and reports every region as `collateral`, ordered by area — the
  ordering [journal 0013](docs/context/journal/0013-observability.md) measured as
  backwards. The wiring is there; the input is not. `observePair` does not rank
  either — it carries one snapshot, so it attributes and stops. Cause-first
  ordering runs today only where `core` is composed by hand with both documents:
  `examples/todomvc/src/observe.chromium.test.ts` and the two
  [`cases/incumbent-case`](cases/incumbent-case) suites.
- **git-LFS exercised as git-LFS.** The store is written, but no clean/smudge
  filter has ever run and no image has been committed through it, so the one
  failure that matters — an un-smudged checkout handing back a pointer file where
  a PNG should be — has only ever been simulated.
- **A shipped collector.** Story-shaped subjects work and one worked example
  exists ([`cases/storybook-case/collector/`](cases/storybook-case/collector),
  341 lines across three files). There is no plugin, and mounting is the
  adopter's to write, once, per project.
- **Any framework but React, actually run.** Provenance needs a component name
  per element. React gets it from fibers; anything else gets it from two `data-*`
  attributes and a 25-line `attributeProvenance`
  ([`packages/dom/src/attributed.ts`](packages/dom/src/attributed.ts)), which is
  what a Vue or Svelte build step already emits. No Vue, Svelte or Angular
  application has been through it.
- **A localized application.** `compareLocales` finds untranslated strings and
  boxes that stopped fitting, measured against real Chromium layout on one panel
  in two languages. One panel is not an application.
- **Linux verification.** Every number here is from one Mac and one Chromium.
- **Generality.** One corpus, built by us. Both profiles agree on it, which proves
  the two collection paths implement one ruleset — not that the ruleset holds on
  someone else's component library.
- **Parity with a hosted product.** The comparison half is measured against one
  real incumbent ([`cases/`](cases)). Of the product half, a review UI and team
  approvals are written and unit-tested but have never been deployed — see the
  next entry. A cross-browser grid and repository-scale change detection do not
  exist here and are not claimed.
- **A deployment of the review backend.**
  [`@variance-authority/cloudflare`](packages/cloudflare) implements the baseline
  store, the history backend, the build-and-approve model and the review surface
  against D1 and R2, and **has never run on Cloudflare.** D1 is SQLite, so its
  93 tests execute the real SQL through `node:sqlite` against an in-memory
  bucket — which verifies the queries, the triggers, the promotion path and the
  routes, and verifies nothing about the platform: batch atomicity, quotas,
  object-size ceilings and concurrent Workers are all unmeasured
  ([ADR-0023](docs/context/adr/0023-a-service-depends-on-what-it-needs.md)).
- **A real agent.** The MCP tools are shaped by argument about what an agent
  needs and tested against text, not against an agent that used them and either
  fixed the thing or did not.

Current state, what is proven and what is open, is kept in
[`docs/context/checkpoint.md`](docs/context/checkpoint.md).

## Reading order

1. [`docs/architecture.md`](docs/architecture.md) — the composition model: tools,
   their contracts, and why there is no pipeline
2. [`docs/flakiness.md`](docs/flakiness.md) — the position on variance
3. [`docs/specs/`](docs/specs/README.md) — what is decided and not yet built, in
   dependency order
4. [`docs/context/README.md`](docs/context/README.md) — how the paper trail works
5. [`docs/context/checkpoint.md`](docs/context/checkpoint.md) — current state
6. [`docs/context/adr/`](docs/context/adr/) — decisions that constrain the code;
   [0003](docs/context/adr/0003-cruft-removal-and-css-applicability.md) is the moat
7. [`docs/context/journal/`](docs/context/journal/) — what was attempted and what it cost

## Development

```bash
yarn install
```

```bash
yarn build && yarn test
```

The M0 measurement, which scores the pipeline against the corpus:

```bash
yarn vitest run examples/kitchen-sink/src/measure.test.tsx
```

The `chromium` half needs a browser, and skips itself with a reason if there is none:

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

What the persistent harness is worth, cold versus warm:

```bash
yarn workspace @variance-authority/example-kitchen-sink bench
```
