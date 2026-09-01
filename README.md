<p align="center">
  <a href="docs/visual-guidelines.md">
    <img src="assets/brand/variance-authority-logo.svg" alt="Variance Authority logo" width="800">
  </a>
</p>

# Variance Authority

**Visual Regression. Verifiable Results.**

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

Variance Authority runs in infrastructure you control, against UI states your
Storybook, application, Playwright tests, or browserless unit tests already know
how to reach. There is no vendor account or hosted dashboard. Capture material
stays local or travels only to a renderer and store you choose.

## One change. One place to look.

The same `Button`, before and after. Only its `background-color` changes; its
content, size, DOM, role, and props stay the same.

| Before | After | Diff |
| --- | --- | --- |
| ![A blue Variance button before the change.](examples/readme-case/artifacts/before.png) | ![The same Variance button in purple after the change.](examples/readme-case/artifacts/after.png) | ![The generated image diff, highlighting the repainted button in red.](examples/readme-case/artifacts/diff.png) |

A pixel diff can show where the image changed. The HTML-aware comparison can
also name what changed and where to review it:

```text
1 root(s): 0 authorized, 1 to review, 0 violation(s).
  [needs-review] Button — Button
      undeclared component change: `Button` (token/paint) reached 1 subject(s)
      examples/readme-case/src/Button.js:9
```

A **root** is a cause, not a screenshot: forty subjects that moved because one
token moved are one root, addressed as `component:Button` or
`token:--va-color-accent` and stable across builds. A branch that declares the
roots it means to change gets each of them back `authorized` and out of the way;
anything undeclared is `needs-review`, or a `violation` where project policy
forbids it. What is left, ranked by cause, is the **docket** — the list a
reviewer or an agent actually works through.

[`examples/readme-case`](examples/readme-case) generates all three images and
that report in the same Chromium run. The generated provenance records the
Chromium engine, the paint-only `background-color` change, and the changed-pixel
count. The displayed diff is derived from the displayed before and after PNGs.

## The document knows what the image cannot

A PNG knows colours and coordinates. It does not know that the changed pixels
came from `Button`, or that only its paint changed while its structure held.

Variance Authority therefore compares the **rendered document**, not just its
image. A run acquires the markup, the CSS that applies to it, the component
ownership chain — React's, read straight off the fiber, with no protocol to
adopt — and whatever source provenance the collector can supply. It then asks
each question at the cheapest representation that can answer it:

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

[`docs/information.md`](docs/information.md) defines how visual, semantic,
source, runtime, presentation, scenario, review, and history records align;
which artifacts cross process and service boundaries; where each storage form
belongs; and how full and partial evidence is created, updated, merged, deleted,
or wiped and redefined.

## Evidence that needs no baseline

Two surfaces answer questions about one interface with nothing to approve and no
verdict to gate on.

[`@variance-authority/presentation`](packages/presentation) senses the
relationships inside one live interface: semantic anchors, spacing, alignment,
inferred baselines, surfaces, prominence, repeated patterns, and Playwright's
independent ARIA reading, as machine-readable evidence an agent can inspect and
paint while it works. Density, dimensions, margins, and utilization stay
telemetry rather than design policy.

[`@variance-authority/scenario`](packages/scenario) records Arrange, Act, Assert
as a state machine. A named precondition is the initial state, each Act labels a
transition, and assessment reads the variance across that edge — which is what
answers whether two executions began differently, and at which Act their
behaviour stopped agreeing.

Neither writes a baseline, an approval, a history row, or an exit code, and what
they measure can still travel: a pair of presentation readings becomes a
presentation signal on the observation it belongs to.
[`docs/presentation.md`](docs/presentation.md) and
[`docs/scenarios.md`](docs/scenarios.md) are the full accounts.

## One drill, more than one subject

Those two are not the edge of it. Two readings that should agree, one thing
varied between them, and a name for whatever stopped agreeing — that is the shape
of every question here, and a picture is only the most obvious material to ask it
of. Four more are the same move against other material:

| Read across | What comes back | Where |
| --- | --- | --- |
| The two states a flag exists to tell apart | The difference between them, carrying an identity of its own — so a change *to that difference* is a result, rather than something you catch by opening two pictures | [`docs/variations.md`](docs/variations.md) |
| The suite against itself, at one revision | Which subjects are watching the same rendering, which of them disagree with no baseline anywhere in it, and what in this run explains each thing that moved | [`docs/composition.md`](docs/composition.md) |
| One subject across its own runs | How often a component has caused an approved change, how many runs since a flake was last seen, and how far a token has drifted across steps no single review ever saw the total of | [`docs/history.md`](docs/history.md) |
| What a workspace publishes | Every subpath a manifest opens and every name it reaches, so a moved re-export is a named change before a consumer's build finds it | [`@variance-authority/package`](packages/package) |

That last row opens no browser and compares no pixels; it answers a release
question rather than a run's. It is in the table because it is the same drill.

And the drill is the claim. None of these is the deepest tool for its own
question: a dedicated auditor knows more about accessibility, and a release
product built for one API format knows more about that format than reading a
workspace's manifests does. What every row shares is the discipline — give the
cause a name that survives the next build, let a branch declare the causes it
means to change, count how often one has come back, and hand back one list ranked
by cause rather than by area. A screenshot is where that is easiest to see, not
the edge of where it applies.

## A real change, a flake, and a neighbour look identical

Three subjects can all report *the pixels moved*, and need three different
people. Telling them apart is a separate job from finding the movement, and it is
the one that decides whether an afternoon is well spent.

A changed subject is therefore collected a second time, twice, each pass varying
exactly one thing:

| | world | time | answers | reported as |
| --- | --- | --- | --- | --- |
| `again` | held | advanced | does this subject move on its own? | `unstable` |
| `alone` | rebuilt | same | did some *other* subject move this one? | `order-dependent` |

Neither is a retry: both outcomes of both are reported, nothing is cleared, and
`variance accept` refuses to promote either — a reading chosen by a race must not
become the thing every later run is measured against. What comes back is not
"this test is flaky" but a component and a band — `Clock (content)` — which is
what a fix can be aimed at.

This is affordable because a green run pays nothing: a subject whose document
digest already matches its baseline's is settled without a render, so the budget
goes to the subjects that moved. The same discipline of one variable runs across
the other axes too — the suite compared to itself at one commit, and a record
across runs kept by a service you deploy.
[`docs/instruments.md`](docs/instruments.md) is the full set, with where each
claim is measured; [`docs/flakiness.md`](docs/flakiness.md) is the position
underneath it, including the four causes of variance nothing here absorbs.

Better than telling a race apart is not running one. Where a suite can reach
inside the subject, it does: the application announces the decision it made —
including the decision *not* to show something, which no screen can be asked
about — and the test waits for that announcement instead of for a paint.
[`@variance-authority/event`](packages/event) is the instrument;
[`@variance-authority/wire`](packages/wire) is the medium it shares with
execution tracing, so one cookie both settles the wait and records which code
that execution entered.

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

The broader corpus scores 38/38 under `jsdom` and 39/39 under
Chromium. It remains the only corpus of its kind in the repository. The
measurement and the evidence still missing are tracked in
[`docs/metrics.md`](docs/metrics.md).

## Examples by showcase

The first three rows form the simple progression: ordinary visual regression,
then one structural question, then one source-selection question. The later
examples and cases are deliberately comprehensive reference surfaces; choose the
smallest surface that answers the question you have:

| Start here | Showcase | Reader question |
| --- | --- | --- |
| [`examples/readme-case`](examples/readme-case) | Ordinary visual regression, with one semantic attribution step | What does a one-component paint regression look like from artifact to review item? |
| [`examples/structural-change`](examples/structural-change) | Advanced structural change, not ordinary visual regression | What changes when pixels hold still but element semantics do not? |
| [`examples/layout-impact`](examples/layout-impact) | Focused source cause, sidebar location, and layout impact | Is this Heading style change in the Sidebar, a 50px panel resize, a 4px button resize, or a structural change? |
| [`examples/selection-reuse`](examples/selection-reuse) | Advanced cached source-graph selection | Which stories can a token edit reach, and what source work can the warm scan reuse? |
| [`examples/agent-claim`](examples/agent-claim) | Advanced agent boundary, declared intent against the run | I just edited this — did the edit land, what else moved, and what did I declare that never happened? |
| [`examples/dynamic-route-flake`](examples/dynamic-route-flake) | Advanced Playwright asset flake and composition | Which pixel difference belongs to a dynamic route, and why does its Fiber boundary not become a source accusation? |
| [`examples/kitchen-sink`](examples/kitchen-sink) | Advanced corpus and profile validation | How do normalization profiles behave against declared ground truth? |
| [`examples/todomvc`](examples/todomvc) | Advanced attribution, flakiness, composition, and render offload | How do attribution and instability behave in an application? |
| [`cases/incumbent-case`](cases/incumbent-case) | Advanced replacement comparison | How does semantic inspection differ from a real screenshot runner? |
| [`cases/storybook-case`](cases/storybook-case) | Advanced Storybook integration, readiness, and flake diagnosis | How does a built Storybook behave through collection, readiness, and CLI diagnosis? |

The examples are project-authored measurement fixtures. The cases are the
stronger evidence: they run against a real external runner or build and can
therefore disagree with the implementation.

## Scope and non-goals

**The technical bargain.**

Variance Authority is not a hosted visual-testing product. That removes an
account, an upload, and a per-snapshot meter. It also moves real responsibility
onto the team adopting it:

| You control | What that means |
| --- | --- |
| **Compute** | Rendering happens on your machines or on a pinned renderer you operate. |
| **Storage** | Baselines can live in a directory, git-LFS, or a service you deploy. Storage location does not change the verdict. |
| **Mounting** | Storybook, served URLs, Playwright suites, and browserless unit DOMs have adapters. A custom component environment supplies its own collector and definition of “ready.” |
| **Provenance** | A component name and a `file:line` come from the collector. React supplies the owner chain off the fiber, and a JSX-source transform carries the authored line; with neither, a name still resolves to where it is declared by reading source. A region nothing can account for is reported as a region, never as a guessed component. |
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

## Choose the shortest path into your suite

Start with the place where your UI already reaches a deterministic, ready
state. Do not rebuild that environment inside Variance Authority.

| Your UI is already ready in | Integration recipe | First complete loop |
| --- | --- | --- |
| A Playwright test | [`@variance-authority/playwright-test`: add an observation](packages/playwright-test/README.md#add-an-observation-to-a-test) | Run → review the `new` candidate → run with `--update-snapshots` → rerun unchanged. |
| A Jest or Vitest jsdom test | [`@variance-authority/unit-test`: capture now, render later](packages/unit-test/README.md) | Unit process writes a resource-closed archive → later `variance run` renders it locally or remotely. |
| A built or served Storybook | [`@variance-authority/storybook-collector`: integrate a Storybook](packages/storybook-collector/README.md#integrate-a-storybook) | `variance doctor` → `variance run` → accept named stories → rerun unchanged. |
| A running application or static build | [`@variance-authority/route-collector`: integrate a route list](packages/route-collector/README.md#integrate-an-explicit-route-list) | Start the app → `variance doctor` → `variance run` → accept named routes → rerun unchanged. |
| A custom renderer, store, or pipeline | [`@variance-authority/observe`: choose the entrypoint](packages/observe/README.md#choose-the-entrypoint) | Call `observePair`, `observeAgainstBaseline`, or `observeRasters`, then handle every returned verdict explicitly. |

If more than one row fits, choose the state owner and material separately. Reuse
an existing Playwright test when its browser owns the meaningful state; choose
in-place pixels for that browser's exact paint or a deferred document for a
renderer with equivalent resource access. Use the unit surface when the test owns a DOM but
must not own a browser. Reuse Storybook before navigating every route
independently; choose routes when the served application is the artifact.

`@variance-authority/playwright-test` is a one-package integration that leaves
the suite's existing `test` and `expect` imports in place. Storybook and route
adoption require the shared CLI plus one collector package;
the collector owns how the UI becomes ready, while the CLI owns baselines,
reports, acceptance, and CI exit codes.

## Documentation

[`docs/`](docs/README.md) is the reference, grouped by the question a reader
arrives with: whether this fits, what a run decides, how a flake is told from a
change, how less of a suite gets run, what needs no baseline, and what each
claim is measured against. [Architecture](docs/architecture.md) is the shape of
the fleet: which package owns which domain, and which way a dependency is
allowed to point. The [visual guidelines](docs/visual-guidelines.md)
define the ribbon mark, palette and illustration grammar used across the
repository and its packages.

## Licence

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Mechanic Garden.
