---
id: TASK-8
title: Compose capture and rendering into adopter-facing offerings
status: Done
assignee:
  - '@codex'
created_date: '2026-08-19 12:08'
updated_date: '2026-08-20 07:52'
labels: []
dependencies: []
references:
  - 'https://argos-ci.com/docs/quickstart/vitest-quickstart'
  - 'https://argos-ci.com/docs/quickstart/storybook-quickstart'
  - 'https://applitools.com/platform/ultrafast-grid/'
priority: high
type: feature
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reshape Variance Authority around one composable visual-regression engine. Host integrations own lifecycle and acquisition; capture may produce an in-place raster or a portable render document; rendering may happen locally or remotely; stabilization, flake recognition, comparison, retention, and reporting remain shared. Preserve the optimized Storybook runner and make Playwright plus vanilla Vitest/Jest adoption honest and additive.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Competitor research identifies verified integration, rendering-topology, stabilization, and flake-handling patterns from primary sources
- [x] #2 Public documentation distinguishes in-place browser capture from portable-document capture and contains no unsupported Vitest/Jest visual-integration claim
- [x] #3 A durable north-star decision defines acquisition, materialization, observation, retention, and reporting as independently composable responsibilities
- [x] #4 The shared engine can process an existing raster or render a portable document through interchangeable local and remote renderers
- [x] #5 The optimized Storybook runner remains supported while Playwright and unit-test offerings expose additive APIs without owning host test or expect primitives
- [x] #6 Consumer-facing tests exercise in-place and deferred-render integration models with real browser evidence where required
- [x] #7 The complete repository build and verification gate passes and a fresh review finds no unresolved blocking defect
- [x] #8 A final documentation audit reconciles every public offering with verified behavior
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Phase 1: research how established products compose host adapters, local screenshots, DOM capture, remote rendering, stabilization, and CI review. Phase 2: audit and remove unsupported claims from docs and READMEs. Phase 3: record the north-star contract. Phase 4: decompose the engine into capture, materialization, observation, retention, and reporting blocks. Phase 5: compose Storybook, Playwright, and vanilla unit-runner offerings from those blocks. Phase 6: add consumer-shaped local and remote integration tests. Phase 7: run deterministic, consumer-surface, and isolated review gates. Phase 8: repeat the documentation audit against the finished behavior.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Carry-the-load increment 1 (frozen before product edits)

Value: a Vitest or Jest adopter can capture a mounted jsdom subject without a browser, persist that evidence, and let the ordinary Variance CLI render and compare it in a later process.
Current flow: acquireDocument and normalize already produce serializable values; renderers may be local or remote; the only proof launches Playwright inside the same Vitest process and no durable handoff exists.
Constraint: there is no adopter-facing capture envelope, artifact writer, or artifact-backed collector, and external resource bytes are not portable.
Increment: add one runner-neutral unit-test surface that writes and reads a versioned self-contained capture archive, compose it with the existing collector/CLI/renderer path, and prove acquisition and rendering in separate processes. Maximum scope: one new package, its consumer-shaped case, the north-star ADR, and directly owned documentation; no Storybook rewrite and no host test/expect replacement.
Misfire: the unit process launches or imports a browser, the later process cannot reproduce inline markup/CSS, or the surface implies external resources are archived when they are not.
Containment: the surface is opt-in, existing collectors and renderers remain unchanged, archive validation refuses malformed/non-self-contained claims, and the current low-level APIs remain available.
Readback: a browserless Vitest process writes the archive; a distinct CLI process with Chromium reads it and produces a real observation; malformed/version-mismatched input is refused.
Learning owner: exported types, validation, consumer test, and the architecture ADR.

Phase 1 evidence

Argos preserves host ownership and composes Vitest/Storybook over one in-place Playwright screenshot primitive; its vanilla snapshot helper does not remotely rasterize HTML. Applitools Grid, Percy Web, and Chromatic instead archive DOM/resources and render later; Applitools Classic, Percy Automate, Argos, and Lost Pixel demonstrate in-place raster paths. Chromatic supplies the clearest repeated-render instability model. Across products, acquisition host, capture material, renderer placement, comparison, and review are orthogonal. Chromium documents font-render-hinting and LCD text as pixel-affecting; they belong in renderer identity. Internal audit confirms existing Renderer local/remote and observeRasters/document paths are reusable, while public integrations hardwire topology and vanilla unit tests lack a durable handoff. External resource bytes remain a correctness boundary for deferred documents.

Increment 1 readback — PASS

Value: a browserless Vitest/Jest-style test can persist a resource-closed capture and a later CLI process can render and observe it.
Observed readback: `packages/unit-test`, raster codec, and observation tests passed 22/22; Playwright renderer tests passed 5/5 with Chromium; `cases/unit-capture-case` passed 1/1 after its child Vitest finished before the CLI launched Chromium. The second CLI run reported one `unchanged` observation.
Protection: version/resource digest validation and refusal tests are retained; existing collectors remain document producers; no host primitive is exported. Learning owner: ADR-0044, CaptureArtifact/RenderResource types, archive validation, and consumer test.
Scope note: the generic CaptureArtifact and observeCaptureAgainstBaseline seam were implemented alongside the unit surface although the frozen maximum named only the new package; they are already-mutated shared-block work and are carried into increment 2 rather than omitted from the report.

Carry-the-load increment 2 (frozen before Playwright edits)

Value: an existing Playwright suite can choose an in-place screenshot without replacing test/expect or launching a second browser, while the same baseline observation path remains available for deferred documents.
Current flow: createVariance always opens a second renderer; the page agent already acquires and stabilizes the caller-owned locator; observeCaptureAgainstBaseline now accepts a candidate raster.
Constraint: no authoritative existing-page Raster is built, browser launch/raster identity must be declared by the host, and one screenshot cannot distinguish a regression from same-run pixel instability.
Increment: add an explicit in-place materialization option to the additive Playwright helper, stamp the live locator screenshot with declared rasterization identity, require two agreeing captures before baseline comparison, and prove direct in-place plus existing deferred behavior through the consumer surface. Maximum scope: playwright-test direct/runtime API, its page agent metadata, tests, and README; Storybook remains unchanged.
Misfire: the helper silently invents launch identity, accepts disagreeing captures, opens a second browser in in-place mode, or changes suite ownership.
Containment: deferred remains the default; in-place requires an explicit host rasterization declaration; existing fixtures and renderer injection remain valid; disagreement throws before baseline lookup or acceptance.
Readback: a real Playwright test using native test/expect records then re-observes an in-place candidate, a launch-recipe change yields incomparable, injected renderer is never called in in-place mode, and the deferred consumer test remains green.
Learning owner: API types, renderer identity, repeated-capture gate, consumer tests, and ADR-0044.

Increment 2 readback: the additive Playwright suite passed 3/3 in real Chromium. Deferred capture remained unchanged; in-place capture made zero injected-renderer calls, returned rendered=false, partitioned a changed launch recipe as incomparable, and refused two disagreeing screenshots after exactly two reads. The Playwright renderer passed 5/5, including resource-closed network refusal and rasterization identity. The browserless-unit consumer passed 1/1: Vitest capture completed in one process and a distinct CLI process then rendered, accepted, and re-observed unchanged.

Review readback

The Phase-8 public documentation audit passes. Follow-up seam reviews drove five additional correctness repairs: context-scoped resource closure with open-document network preservation, complete nested capture-archive validation, viewport-specific renderer-owned selection identity, one animation intervention for in-place semantics and pixels, and setup ordering that cannot leak an owned renderer. Build, lint, 2,553 repository checks, 33 focused unit/jsdom/CLI tests, and the reviewing agent’s 46 focused Node tests pass. Earlier real-Chromium consumer and renderer suites passed before the final egress/animation changes. Fresh Chromium execution and the final git stage/commit are not complete because the environment rejected browser and .git escalation after the account approval quota was exhausted; these remain the only open acceptance-criterion-7 evidence.
Gate readback — PASS

The previously unvalidated browser evidence ran and found one real defect. `routeWebSocket`
does not cover a page that has never committed a navigation, and `setContent` does not commit
one, so the resource-closed WebSocket policy was installed and silently inert: a resource-closed
document could open a socket unrefused, and the refusal test had never executed to say so. The
page pool now commits `about:blank` for closed contexts before first use, which engages
interception while leaving the page URL — and so the resolution context for a document carrying
no `<base>` — unchanged. Verified against the alternative causes: the route survives the
per-render `unrouteAll` and pooled page reuse; only the uncommitted navigation was at fault.

Full gate on this machine: build, lint, 2,563 repository checks, and 174 test files / 2,244 tests
pass (48 skipped, 20 todo). That includes all nine remote-renderer tests over localhost, the
seven-test Playwright renderer suite, and every Chromium consumer suite — playwright-additive,
unit-capture, storybook-case, engines, network, and playwright-test direct.

ADR-0044 gained the coherence matrix it was missing. It asserted the axes were independent but
never enumerated the host x material cells, so the one structural asymmetry went unrecorded:
jsdom produces no pixels, so in-place raster is impossible there, which is exactly why the
unit-runner offering is document-only and is an offering rather than a gap. Vitest Browser Mode
is named as not-a-row. Shipped state stays in `surface.md`; the two coherent-but-unbuilt cells
(Storybook in-place, route-collector in-place) are now `it.todo` at the sites their tests would
occupy, rather than prose in the ADR.
<!-- SECTION:NOTES:END -->
