# Comparison

Visual-regression systems differ first in what they capture, where pixels are
made, and who operates review. Those decisions determine privacy, browser
coverage, reproducibility, latency, and price more directly than the name of the
test runner adapter.

Vendor facts below come from the vendors' published documentation. Pricing and
hosted-service features change; the linked pages are the authority for a buying
decision. Variance Authority claims point to the package or document that owns
the contract.

## 1. The dimensions a buyer actually decides on

| Dimension | Percy | Chromatic | Argos | Applitools | Variance Authority |
| --- | --- | --- | --- | --- | --- |
| Acquisition | SDK captures DOM/resources or Automate captures the running browser | Storybook or E2E archive | Host adapters reach a page and Playwright produces screenshots | Classic SDK captures in place; Ultrafast Grid captures a DOM snapshot | Storybook/routes/unit tests emit a `RenderDocument`; Playwright emits a document or in-place `Raster` |
| Pixel placement | Percy cloud, or the Automate browser | Capture Cloud | Caller-owned browser | Caller browser or Ultrafast Grid | Caller-owned browser, local renderer, or operator-owned remote renderer |
| Review | Hosted dashboard and approval workflow | Hosted UI Test and UI Review | Hosted test review, comments, and flake history | Eyes Test Manager | JSON/HTML/CLI/MCP evidence; approval is an operator command |
| Browser breadth | Managed desktop/mobile coverage | Managed browser and mode matrix | Whatever the caller's capture suite runs | Managed grid plus mobile products | Chromium, Firefox, and WebKit renderers the operator installs and runs |
| Existing PNG input | Product-specific SDK paths | No general PNG intake | CLI upload | SDK checkpoints | Library seam through `observeRasters` or raster `CaptureArtifact`; no CLI ingest command |
| Source attribution | DOM/CSS root-cause aids | Story identity and dependency tracing | Spec/story metadata | DOM/CSS root-cause aids | Pixel region → component → `file:line` when acquisition supplies matching provenance |
| Operations | Vendor | Vendor | Vendor, with an open-source self-host option outside the supported service contract | Vendor or contracted on-premise deployment | Adopter |

The Variance integration matrix and exact material/placement choices are in
[`surface.md`](surface.md). The underlying decision is recorded in
[ADR-0044](context/adr/0044-capture-material-and-rendering-placement-are-independent.md).

### The one commercial fact worth isolating

Hosted products meter different units. Percy and Argos count screenshots;
Chromatic counts snapshots with product-specific multipliers; Applitools defines
a Page independently of browser/device repetitions. A useful estimate therefore
starts with the vendor's unit, not with a raw subject count:

```text
subjects × viewports × browsers × modes × selected builds
```

Variance Authority has no vendor meter. Compute, storage, renderer capacity,
retention, upgrades, and operational labour belong to the adopter. “No per-shot
bill” is not the same claim as “free.”

Sources: [Percy pricing](https://www.browserstack.com/pricing?product=percy),
[Chromatic billing](https://www.chromatic.com/docs/billing/),
[Argos pricing](https://argos-ci.com/pricing), and
[Applitools terms](https://applitools.com/terms-of-use/).

## 2. What each competitor does better than this project

### Percy

Percy supplies broad SDK coverage, managed rendering, a hosted approval surface,
and BrowserStack's browser/device operations. Its DOM-snapshot workflow captures
resources in the test environment and renders later; Automate instead observes
the running browser. That is a useful example of one product supporting both
materialization topologies.

Choose Percy when managed browser coverage, organization-wide review, or a wide
SDK catalog is more valuable than operating the rendering and evidence stack.

Sources: [SDK workflow](https://www.browserstack.com/docs/percy/integrate/percy-sdk-workflow),
[supported SDKs](https://www.browserstack.com/docs/percy/overview/supported-sdks),
and [review workflow](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/approval).

### Chromatic

Chromatic makes Storybook the product boundary: stories are the subject catalog,
Capture Cloud owns rendering, and the review system connects tests, branches,
baselines, and reviewers. TurboSnap uses the module graph to avoid snapshots a
change cannot reach. SteadySnap adds render stabilization and repeated-capture
techniques within the managed service.

Choose Chromatic when Storybook is the canonical UI inventory and non-engineer
review, branch semantics, and managed stability matter more than self-operation.

Sources: [Storybook workflow](https://www.chromatic.com/docs/storybook/),
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
render placement being independent: the SDK records DOM/resources and a managed
fleet produces browser/device rasters later.

Choose Applitools when managed cross-browser/mobile coverage, perceptual match
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
- Jest/Vitest jsdom: browserless acquisition → capture archive → later CLI
  process → local/remote render → shared observation.
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

## 4. Operational boundaries

Variance Authority provides libraries and a CLI for infrastructure the adopter
operates. It does not provide a managed browser fleet, hosted reviewer accounts,
support SLA, contractual data residency, or vendor-operated retention.

The CLI supports Storybook, explicit routes/static directories, artifact-backed
unit capture, and custom collectors. The additive Playwright package operates
inside the suite and leaves `test` and `expect` with Playwright. Raster input is a
library seam; the CLI has no arbitrary-PNG ingest workflow.

Remote rendering and storage use operator-supplied endpoints. Resource-closed
documents may cross that boundary; in-place raster capture can keep DOM material
inside the test environment and move only pixels to later systems.

## 5. When not to choose this

Choose a managed product when any of these are hard requirements:

- a hosted review UI for designers, product managers, or assigned reviewers;
- vendor-operated browser/device coverage;
- broad framework/runner SDK coverage with supported upgrades;
- perceptual or ML matching as the primary verdict;
- contractual support, residency, audit, or uptime commitments;
- a vendor-owned flake quarantine and baseline-branching workflow.

Choose the Variance composition when component/source attribution, explicit
evidence boundaries, local or operator-controlled data placement, and the ability
to combine browserless, deferred, and in-place capture are worth the operational
ownership.
