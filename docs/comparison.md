# Comparison

Visual-regression systems differ first in what they capture, where pixels are
made, and who operates review. Those decisions determine privacy, browser
coverage, reproducibility, latency, and price more directly than the name of the
test runner adapter.

They also decide what the practice costs. Visual review is paid for twice: once
in the meter, and once in the hours somebody spends deciding whether a diff
mattered. Both bills are driven by one quantity — how many comparisons reach a
person — and an architecture fixes that quantity long before a report does.

Vendor documentation is authoritative for vendor behaviour. Verify pricing and
hosted-service features there before buying; both change independently.
Variance Authority entries state the capture and operational contracts available
to an adopter.

## 1. The dimensions a buyer actually decides on

| Dimension | Percy | Chromatic | Argos | Applitools | Variance Authority |
| --- | --- | --- | --- | --- | --- |
| Acquisition | SDK captures the DOM and its resources, or Automate captures the running browser | Storybook or E2E archive | Host adapters reach a page and Playwright produces screenshots | Classic SDK captures in place; Ultrafast Grid captures a DOM snapshot | Storybook, routes and unit tests emit a `RenderDocument`; Playwright emits a document or an in-place `Raster` |
| Pixel placement | Percy cloud, or the Automate browser | Capture Cloud | Caller-owned browser | Caller browser or Ultrafast Grid | Caller-owned browser, local renderer, or operator-owned remote renderer |
| Review | Hosted dashboard and approval workflow | Hosted UI Test and UI Review | Hosted test review, comments, and flake history | Eyes Test Manager | Self-hosted `tribunal` — builds, docket, region overlays, recorded decisions, posted by `variance push`; or the same evidence as JSON, HTML, CLI output or MCP |
| Browser breadth | Managed desktop and mobile coverage | Managed browser and mode matrix | Whatever the caller's capture suite runs | Managed grid plus mobile products | Whatever the caller's capture suite runs |
| Existing PNG input | Product-specific SDK paths | No general PNG intake | CLI upload | SDK checkpoints | Library seam through `observeRasters` or raster `CaptureArtifact`; no CLI ingest command |
| Source attribution | DOM and CSS root-cause aids | Story identity and dependency tracing | Spec and story metadata | DOM and CSS root-cause aids | Pixel region → component → `file:line`, when the capture supplies matching provenance |
| Compared against | The approved baseline | The approved baseline | The approved baseline | The approved baseline | The baseline. Also, within a single run: two related states, compared for the gap between them; and one input rendered twice, compared for the point where the two renderings diverge |
| Change-driven selection | No documented equivalent | TurboSnap uses the module graph to avoid snapshots a change cannot reach | No documented equivalent | No documented equivalent | `--since` skips a subject when its baseline lists none of the components the change reached. This applies to stories, routes, and Playwright subjects alike. Instrumented test runs also select test files by what they executed |
| Operations | Vendor | Vendor | Vendor, with an open-source self-host option outside the supported service contract | Vendor or contracted on-premise deployment | Adopter |

**Percy** and **Argos** leave selection to you: you shard the suite yourself.
That is a deliberate design choice, not a missing feature, and it keeps a run's
coverage independent of how well a graph was read.

The selection row divides on one axis: what a change imports versus what its
tests executed. TurboSnap reads the static module graph, and Variance Authority's
optional file graph is the same family of thing — a specifier scan over `import`,
`require`, `@use` and `url()` — which answers only the file-to-component half.
What decides a skip is the other half, and it is not a prediction: a stored
baseline records the components the document that painted it actually rendered,
so a subject is skipped because the last run established what it is made of, and
never because a graph said so.
[Wallaby.js](https://wallabyjs.com/) holds the execution-side index, and takes it
further than Variance Authority. Its Test Story Viewer shows one test's full
execution history in a single view: executed lines highlighted, context faded,
file names shown where execution crosses files, with a time-travel debugger
attached. Variance Authority exposes the underlying index through
`coveringTests`, not a time-travel viewer. Given a source line or function, it
returns the individual tests that executed it, nearest call stack first, from an
execution index supplied by any collector. The shipped integration records one
entry per test file and stores no call-stack depth, so per-test answers require a
collector that already records them.

The Variance integration matrix and exact material/placement choices are in
[`surface.md`](surface.md). The underlying decision is recorded in
[ADR-0044](context/adr/0044-capture-material-and-rendering-placement-are-independent.md).

### The cost of a comparison

Hosted products meter different units. Percy and Argos count screenshots;
Chromatic counts snapshots with product-specific multipliers; Applitools defines
a Page independently of browser and device repetitions. A useful estimate therefore
starts with the vendor's unit, not with a raw subject count:

```text
subjects × viewports × browsers × modes × selected builds
```

The same multiplication drives the other bill. Every comparison that survives to
a person is a decision somebody makes, and a suite that surfaces more than it
should is a standing assignment rather than a test run.

What separates the products is where intelligence sits relative to the spend.
Perceptual match levels, hosted review queues, and classifiers that read a
produced result all run after a comparison has been captured, rendered, and
metered: they can reduce the review bill and not the meter. TurboSnap is the
exception in this set, and the honest peer — it prunes before the capture, from
the static module graph.

This project prunes twice, and neither prune is a prediction. `--since` skips a
subject when its stored baseline lists none of the components the change reached,
so the skip rests on what the last run recorded the subject to be made of. What
survives is then decided at the cheapest representation that can decide it (§3.3):
structure, semantics, authored CSS, and provenance settle a question without a
raster, and raster comparison runs for the questions that need pixels.

None of that is a universal speed claim, and one path deliberately spends more.
In-place capture takes repeated agreeing screenshots to classify same-run
instability: it buys an answer rather than a saving.

Variance Authority has no vendor meter. Compute, storage, renderer capacity,
retention, upgrades, and operational labour belong to the adopter. “No per-shot
bill” is not the same claim as “free.”

Sources: [Percy pricing](https://www.browserstack.com/pricing?product=percy),
[Chromatic billing](https://www.chromatic.com/docs/billing/),
[Argos pricing](https://argos-ci.com/pricing), and
[Applitools terms](https://applitools.com/terms-of-use/).

## 2. Where the managed products lead

### Percy

Percy supplies broad SDK coverage, managed rendering, a hosted approval surface,
and BrowserStack's browser and device operations. Its DOM-snapshot workflow captures
resources in the test environment and renders later; Automate instead observes
the running browser. That is a useful example of one product supporting both
materialization topologies.

Choose Percy when managed browser coverage, organization-wide review, or a wide
SDK catalog is more valuable than operating the rendering and evidence stack.

Sources: [SDK workflow](https://www.browserstack.com/docs/percy/integrate/percy-sdk-workflow),
[supported SDKs](https://www.browserstack.com/docs/percy/overview/supported-sdks),
and [review workflow](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/approval).

### Chromatic

Chromatic makes Capture Cloud the product boundary. Stories are one subject
catalog and Playwright or Cypress runs are another, contributing full-page
archives of DOM, styling, and assets taken from a real application; Capture Cloud
owns rendering, and the review system connects tests, branches, baselines, and
reviewers. TurboSnap uses the module graph to avoid snapshots a
change cannot reach. SteadySnap adds render stabilization and repeated-capture
techniques within the managed service.

Component isolation is therefore a choice an adopter makes rather than a limit
the product imposes: a page-level story and an archived end-to-end flow both
reach the same review surface. What an archive fixes is the moment of capture — a
recorded DOM is repainted later, so the run that produced it is no longer there
to be asked a question.

Choose Chromatic when review should be a product — Storybook inventory, E2E
archives, or both — and non-engineer review, branch semantics, and managed
stability matter more to you than self-operation.

Sources: [Storybook workflow](https://www.chromatic.com/docs/storybook/),
[Playwright visual tests](https://www.chromatic.com/docs/playwright/),
[TurboSnap](https://www.chromatic.com/docs/turbosnap/), and
[SteadySnap](https://www.chromatic.com/features/steadysnap).

### Argos

Argos keeps rendering in the caller's browser. Its Playwright primitive captures
in place; the Vitest and Storybook quickstarts are thin host compositions over
that browser capture, followed by upload. This is not a browserless HTML archive
that a remote browser later paints.

Argos also supplies the mature review half: per-test history, recurrence-based
flake information, ignored-difference management, comments, and reviewer state.
Choose it when the suite should own pixels but the vendor should own review and
history.

Its Chromium examples use both `--disable-lcd-text` and
`--font-render-hinting=none`; Variance's Chromium renderer uses the same defaults
and records the ordered launch recipe in renderer identity.

Sources: [Playwright quickstart](https://argos-ci.com/docs/quickstart/playwright),
[Vitest quickstart](https://argos-ci.com/docs/quickstart/vitest-quickstart),
[Storybook quickstart](https://argos-ci.com/docs/quickstart/storybook-quickstart),
and [flaky-test detection](https://argos-ci.com/docs/learn/reliability-and-flakiness/flaky-test-detection).

### Applitools

Applitools exposes both an in-place Classic runner model and a capture-once,
render-many Ultrafast Grid. The grid is the clearest example of acquisition and
render placement being independent: the SDK records the DOM and its resources, and a
managed fleet produces browser and device rasters later.

Choose Applitools when managed cross-browser and mobile coverage, perceptual match
levels, enterprise workflow, or an on-premise commercial deployment is required.

Sources: [Ultrafast Grid](https://applitools.com/docs/eyes/concepts/test-execution/ultrafast-grid),
[match levels](https://applitools.com/docs/eyes/concepts/best-practices/match-levels),
and [deployment modes](https://help.applitools.com/hc/en-us/articles/360007189231-The-different-deployment-modes).

## 3. Where composition differs

Variance Authority treats host acquisition, capture material, rendering
placement, observation, retention, and reporting as independent responsibilities.
An adapter is useful only when it removes host-specific work without taking over
the host's runner or creating a second comparison system.

### 3.1 A diff that names a component and a file

PNG comparison produces regions. Component attribution requires a semantic
snapshot of the same subject, and source attribution requires provenance carried
during acquisition. With both present, a region can resolve to a component and
then to `file:line`. Without them, the observation remains a pixel result and the
missing fields stay absent.

React acquisition reads owner information; another framework can emit the same
public provenance shape through `data-*` metadata. This is an acquisition
capability, not something a differ can recover from image bytes.

See [`attribution.md`](attribution.md) and [`source.md`](source.md).

### 3.2 Capture material and rendering placement

`CaptureArtifact` is the shared envelope:

```text
CaptureArtifact = RenderDocument | Raster
```

A document must be resource-closed before it is called portable. It can then be
rendered locally or across the `Renderer` protocol. A raster is already painted;
it skips rendering and reaches the same durable observation path. Renderer
identity covers engine, platform, scale, fonts, stabilization, and rasterization
recipe so incompatible baselines are `incomparable`.

The resulting adopter surfaces are compositions rather than separate products:

- Storybook and routes: browser acquisition → environment-dependent document →
  local render or remote renderer with equivalent resource access → shared
  observation.
- Jest or Vitest jsdom: browserless acquisition → capture archive → later CLI
  process → local or remote render → shared observation.
- Playwright Test deferred: caller locator → environment-dependent document →
  renderer with equivalent resource access → shared observation.
- Playwright Test in place: caller locator → repeated agreeing screenshots →
  raster → shared observation.

### 3.3 Deciding at the cheapest representation that can decide

Structure, semantics, authored CSS, and provenance do not require a pixel render.
Raster comparison runs only for questions that need pixels. Content-addressed
documents and render caches make that separation useful across reruns. An
unobservable band reports `unobserved`; it is not converted into an empty result
or a pass.

This is a cost structure, not a universal speed claim. In-place capture avoids a
second browser but takes repeated screenshots to classify same-run instability.
Deferred capture pays archive and rendering costs but gains placement freedom and
cache reuse.

See [`architecture.md`](architecture.md), [`instruments.md`](instruments.md),
and [`flakiness.md`](flakiness.md).

### 3.4 Comparisons that need no prior good state

Every product in §1 compares a subject against its approved baseline, which
answers one question: did this change since the last time somebody said it was
right. Two comparisons here answer different questions, and neither consults
history.

A subject declared as a variation of another — `variance-parent:<id>` — is
compared against the subject it varies, in the same run. The reported difference
carries a digest taken over the difference itself, so it holds still while both
sides move together and moves when the variation gains or loses something its
parent does not have. A token edit that turns the whole suite red leaves that
digest where it was. That separates *everything moved and the flag still does
what it did* from *the flag now does something else* — a distinction a reviewer
otherwise draws by hand, on every diff. Nothing on this axis reaches the exit
code, `accept`, or the baseline store. See [`variations.md`](variations.md) and
[ADR-0045](context/adr/0045-a-subject-may-be-a-variation-of-another-subject.md).

A changed subject is also read a second time, and the two second passes vary one
thing each: `again` holds the world and advances time, `alone` rebuilds the world
and holds time. Each compares two readings of one input rather than a reading
against a baseline, and because a document carries its component hashes the
answer is a component and a band instead of a page to re-examine. The order is
load-bearing — `again` runs first, because `alone`'s inference is only evidence
once two readings of one world are known to agree. See
[`flakiness.md`](flakiness.md) and
[ADR-0030](context/adr/0030-two-second-passes-one-variable-each.md).

Both are the labour half of the cost of a comparison made structural. A
difference a digest has already settled, and a movement already named as an
unstable component, are two things nobody is asked to look at twice.

## 4. Operational boundaries

Adopter operation is what the absent meter is bought with. Variance Authority
provides libraries and a CLI for infrastructure the adopter operates, and the
arrangement that removes the per-shot bill is the same one that puts compute,
storage, renderer capacity, and the pager on the team. It does not provide a
managed browser fleet, hosted reviewer accounts, support SLA, contractual data
residency, or vendor-operated retention.

That ownership is also where data placement is decided. Remote rendering and
storage use operator-supplied endpoints. Resource-closed documents may cross that
boundary; in-place raster capture can keep DOM material inside the test
environment and move only pixels to later systems.

The CLI supports Storybook, explicit routes and static directories, artifact-backed
unit capture, and custom collectors. The additive Playwright package operates
inside the suite and leaves `test` and `expect` with Playwright. Raster input is a
library seam; the CLI has no arbitrary-PNG ingest workflow.

## 5. When not to choose this

Percy, Chromatic, Argos, and Applitools supply managed browser coverage, hosted
review links, and vendor support. **Buy one of them when visual review should be a
product rather than infrastructure you run** — when nobody on the team wants to
own a renderer image, a storage bucket, an upload path, and the pager that comes
with them.

Choose Variance Authority when a changed screenshot should arrive as one cause
with its evidence, and be settled in one decision — and when
component and source attribution, explicit evidence boundaries, and local or
operator-controlled data placement are worth the operation they cost. It asks for
more from the team and gives back a different kind of answer, which is a trade
rather than an upgrade.
