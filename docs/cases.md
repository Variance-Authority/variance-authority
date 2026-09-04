# Choosing a composition

Start from the state owner, then choose capture material and renderer placement.
Those choices are independent: a Storybook or route host does not imply local
rendering, and a Playwright host does not imply in-place pixels.

## The three questions

| Question | Choices | Consequence |
| --- | --- | --- |
| Where is the UI already ready? | Storybook, served routes or static output, Playwright Test, browserless unit DOM, custom host | Selects the lifecycle, the discovery mechanism, and the naming adapter |
| What crosses the acquisition boundary? | RenderDocument — environment-dependent or resource-closed — or already-painted Raster | Selects portability, disclosure, and which semantic evidence can travel |
| Where are pixels made? | Caller browser, local renderer, operator-owned remote renderer | Selects latency, reproducibility, infrastructure, and renderer identity |

Observation, baseline lookup, comparison, attribution, acceptance, and reporting
remain the same downstream contracts.

## Built or served Storybook

Use `@variance-authority/storybook-collector` when stories are the canonical
subject catalog. The collector operates beside Storybook, reads its index, reuses
one preview, applies story viewports before mount, waits for the rendered state,
and emits documents. External resource hashes enter identity, but the collector
does not archive the bytes.

Choose it when:

- story ids are the desired baseline ids;
- decorators and play functions own the ready state;
- the Storybook build must remain untouched;
- a local renderer, or a remote renderer with equivalent resource access, owns
  pixels.

If the served route is the product state under review, use the route composition.

## Served routes or static output

Use `@variance-authority/route-collector` for an explicit map of stable subject
ids to URLs, or for static output whose HTML files are the chosen subjects. Each
viewport is planned separately and navigation happens at that viewport.

Choose it when:

- the application route, not an isolated component, is the subject;
- the state can be reached by deterministic navigation and setup;
- the route list is an owned contract.

The collector is not a crawler. Link discovery and sitemap churn can silently
change coverage, so they are not treated as subject selection.

## Existing Playwright Test

Use `@variance-authority/playwright-test` when the suite already owns the page,
fixtures, navigation, and ready state. The package exports observation and
assertion helpers; `test` and `expect` remain imports from `@playwright/test`.

Choose deferred materialization when:

- a pinned local renderer, or a remote renderer with equivalent resource access,
  should own pixels;
- render-cache reuse is valuable;
- disclosing the DOM and its resources across that renderer boundary is
  acceptable.

Choose in-place materialization when:

- the exact caller browser paint is the evidence;
- a second browser would duplicate expensive state;
- DOM material must stay inside the test environment.

In-place capture requires an explicit browser launch recipe, captures at least
twice, and refuses disagreement before baseline comparison.

## Browserless Jest or Vitest

Use `@variance-authority/unit-test` when the test process owns a mounted DOM but
must not own a browser. `capture` writes the semantic and document evidence,
`writeCapture` persists it, and a later CLI process loads it through
`captureCollector` and renders locally or remotely.

Choose it when:

- the ordinary Jest or Vitest lifecycle must remain unchanged;
- browser startup does not belong in unit workers;
- resource bytes can be closed during capture;
- acquiring in one process and rendering in another is acceptable.

There is no visual verdict inside jsdom. Vitest Browser Mode with the Playwright
provider is the Playwright composition.

## Existing rasters

Use `observeRasters` to compare two rasters already in hand, or a raster
`CaptureArtifact` with `observeCaptureAgainstBaseline` for durable lookup. No
renderer is constructed or called on that path.

Choose it when another trusted system owns capture and can declare the painter
identity. Without a matching semantic snapshot, the result has pixel regions but
no component, band, exclusion, or source evidence. The CLI has no arbitrary-PNG
ingest workflow.

## Local or remote deferred rendering

Both implement the same Renderer contract. Local rendering owns a browser in the
current process. Remote rendering sends a document to an operator endpoint and
returns the raster plus identity. A resource-closed document carries its bytes;
an environment-dependent document requires the endpoint to reach equivalent
resources through its preserved base URL.

Choose local when setup and transport cost dominate. Choose remote when a shared
pinned machine, data-center placement, or renderer fan-out is worth the network
boundary. Resource closure is required for deterministic cross-environment
painting without shared resource access.

## Retention choices

| Retention | Baseline owner | Fit |
| --- | --- | --- |
| Ephemeral | none | Two revisions rendered in one run; no approval history |
| Directory | checkout/CI workspace | Simple durable baseline with explicit file ownership |
| Git LFS | repository plus LFS service | Baselines travel with source workflow while large bytes stay out of ordinary blobs |
| Remote store | operator service | Shared baselines across workers or repositories |

Changing the store backend must not change verdict semantics. A store failure is
an operator error, never a missing baseline.

## When the answer is a managed product

Choose Percy, Chromatic, Argos, or Applitools when the required outcome is a
vendor-operated review surface, browser and device fleet, support contract,
branch baseline workflow, perceptual differ, or compliance commitment.
Self-operation is a product boundary, not a feature-equivalent substitute for
those services.

See [comparison.md](comparison.md#5-when-not-to-choose-this) for the vendor
models and [surface.md](surface.md) for exact package APIs.
