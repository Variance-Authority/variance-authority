# Variance Authority

> Percy shows you pixels. Variance Authority tells you `Button` broke the hero.

A deterministic verification layer for frontend surfaces, built for agent-driven
development. It answers *"what changed, why, where, and should anyone care?"* at
the cheapest representation capable of deciding — in your own infrastructure.

**Status: M0 spike.** The pipeline runs end to end under **both** profiles and is
measured against a corpus with pre-declared ground truth — 38/38 under `jsdom`,
39/39 under `chromium`, zero false verdicts either way. The raster tier, the two
retention modes and an MCP surface followed. There is no CLI, no manifest, no
hosted anything, and nothing is published. Read [what does not exist
yet](#what-does-not-exist-yet) before believing any of the rest.

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

**Connecting pixels to code lines.** *(built and measured)* A comparison stops at
a mask rather than a number; the mask clusters into regions; regions join the box
tree; the tree knows which component produced each node; the component resolves
to a file:

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

**Tracking accumulated change over time.** *(designed, not built — see
[spec 0002](docs/specs/0002-history-store.md))* A button gains 2px,
eleven times, each approved correctly, and nobody ever sees the 22px change. No
threshold catches that, because the quantity that would have is a **sum** and
nothing in a one-run-at-a-time tool is summing. What gets recorded is one content
hash per band per component boundary plus the resolved token values — never
pixels, never images, never coordinates — so `--va-space-3: 12px → 20px across
eight approvals` becomes an exact, machine-independent sentence.

> We can make VR an immensely valuable tool.

---

### "Where do test cases come from?"

**From you.** Jest, Vitest, Storybook, Playwright — you choose. There is no
separate test format to author and no DSL to learn; a subject is whatever your
existing suite already mounts.

Both rendering surfaces emit the same snapshot format and enter the same
normalizer, so a subject can be decided in a unit test today and in a browser
tomorrow without being written twice.

*Built: Vitest/Jest via `jsdom`, and Playwright. Story-shaped subjects work; a
Storybook plugin does not exist.*

### "Where are results stored?"

**Git-LFS, like Percy — or your own server, like Chromatic or Argos. You choose.**
Git-LFS is the default because it needs no infrastructure, and because a baseline
image is never hand-merged: you take one side.

History is a different artifact with different rules — see the next question.

*Designed, not built. Today the durable store is a local directory partitioned by
renderer identity.*

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

*Designed, not built.*

### "Who runs the pipeline?"

**You do — locally, on pre-commit, or in CI. You configure it.** Nothing here
phones anything, schedules anything, or needs a hosted control plane to reach a
verdict.

*Built as a library. There is no CLI yet, so today "configure it" means calling
the packages from your own test files.*

### "Who generates the images?"

**Your CI bot can, and commit them back to the PR with comments. Bring your own
workflow.** The pieces are deliberately separable — acquisition, assembly,
rendering, comparison, isolation and attribution are six independent phases, and
only two of them need a browser. A document acquired in a unit test can be
rendered by a pinned machine elsewhere, proven byte-identical in-process and over
an HTTP hop.

*Built: the phases, the remote renderer, the offload. Not built: the GitHub
Action, the PR comment, the commit-back.*

### "Where does it work?"

**Any Linux terminal** — your dev machine, GitHub Actions, Bitbucket Pipelines.
It is Node and Playwright, with no service dependency and no daemon.

*Honest limit: every measurement in this repository was taken on one Mac with one
Chromium. Linux CI is the intended target and is not yet verified.*

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
| [`dom`](packages/dom) | a live DOM | extraction, and CSS applicability pruning |
| [`react`](packages/react) | React internals | fibers → owner chains, props digests, portals |
| [`session`](packages/session) | a live DOM | many subjects in one standing world |
| [`playwright`](packages/playwright) | a browser | the persistent harness, and a renderer |
| [`png`](packages/png) | a PNG codec | decoding, comparison, the diff image |
| [`store`](packages/store) | a filesystem | baselines on disk, and in git-LFS |
| [`remote`](packages/remote) | a socket | a renderer and a store across a hop |
| [`server`](packages/server) | a database | the history service you run |
| [`mcp`](packages/mcp) | stdio | the observation, exposed to an agent |

**Composes the above**

| | |
|---|---|
| [`observe`](packages/observe) | one composition, shipped as an example — the only place in the repository where an order is hard-wired |
| [`cli`](packages/cli) | the workflow, which is the one place a workflow belongs |

| | |
|---|---|
| [`examples/kitchen-sink`](examples/kitchen-sink) | 8 subjects, 40 declared cases — the measurement's ground truth |
| [`examples/todomvc`](examples/todomvc) | a small design system, the pixel arm, and the end-to-end |
| [`cases/storybook-case`](cases/storybook-case) | a real Storybook, built by Storybook, read from outside |
| [`docs/context/`](docs/context) | the paper trail: ADRs, journal, helix checkpoint |

Every package has a README stating what it requires and what its entrypoints
cost.

Dependencies point downward only. Collectors extract; `core` normalizes. That
split is what makes one ruleset serve both profiles by construction, and what
lets a capture cross a network hop to a remote renderer unchanged.

The layout is a test rather than a convention — see
[ADR-0013](docs/context/adr/0013-packages-are-named-for-their-requirements.md)
and `tools/boundaries.test.ts`, which fails when an import goes undeclared, a
requirement gains a second owner, or an advertised entrypoint stops resolving.

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

Stated plainly, because everything above is easier to believe with this beside it.

- **History.** No per-component band hashing, no store, no drift answers. Decided
  in [spec 0001](docs/specs/0001-component-hashing.md) and
  [spec 0002](docs/specs/0002-history-store.md), not written.
- **A CLI, a manifest, a GitHub Action, PR comments, commit-back.** The packages
  are a library; the workflow around them is yours to write today.
- **Git-LFS and remote artifact storage.** The durable store is a local directory.
- **Storybook integration.** Story-shaped subjects work; a plugin does not exist.
- **Linux verification.** Every number here is from one Mac and one Chromium.
- **Generality.** One corpus, built by us. Both profiles agree on it, which proves
  the two collection paths implement one ruleset — not that the ruleset holds on
  someone else's component library.
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
