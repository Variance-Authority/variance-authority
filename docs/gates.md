# Can this replace what you are paying for?

Replacement depends on the job being bought. These gates cover capture,
comparison, attribution, and CI operation. Managed review, browser fleets, and
vendor commitments remain separate buying decisions; see
[`comparison.md`](comparison.md).

## Gate 1 — Percy

**Job:** a known set of URLs or static pages, captured at several widths and
gated in CI.

| Requirement | Fit |
| --- | --- |
| Explicit route list | **yes** — `@variance-authority/route-collector` |
| Static directory | **yes** — the route collector serves and plans its HTML files |
| Sitemap or crawler discovery | **partial** — `sitemap` reads a list the application publishes about itself, under `subjects.kind: "collector"`; a crawler is refused, because following what a fetched page points at makes the subject list whatever shipped on Tuesday |
| Several widths | **yes** — each width is a distinct planned subject |
| Local or remote deferred render | **yes** — `portable: true` closes the collected document over the bytes the wire served |
| Vendor-hosted device and rendering fleet | **no** — engines and capacity are operator-owned |
| Hosted review UI | **partial** — `@variance-authority/tribunal` provides self-hosted review with per-subject decisions; [`variance push`](../packages/cli/README.md#push-put-a-build-in-front-of-a-reviewer) uploads runs using an operator-supplied review endpoint and ingest token |

**Verdict:** suitable for an explicit route/static suite when operator-owned
rendering and review are acceptable. Choose Percy when managed breadth or hosted
review is part of the job.

## Gate 2 — Argos

**Job:** capture screenshots from existing test environments, compare them, and
track review or flake history.

| Requirement | Fit |
| --- | --- |
| Additive Playwright capture | **yes** — native `test` and `expect` stay with Playwright |
| In-place page screenshot | **yes** — two or more agreeing captures become the candidate raster |
| Deferred render instead | **yes** — the same adapter can emit a document |
| Existing raster library input | **yes** — `observeRasters` and raster `CaptureArtifact`; a foreign image declares its painter, and two painters return `incomparable` rather than a wall of red |
| Arbitrary PNG CLI upload | **no** — the CLI has no ingest workflow |
| Renderer identity | **yes** — engine, platform, scale, fonts, stabilization, and launch recipe partition baselines |
| Hosted comments, reviewers, and flake register | **no** — those are Argos product capabilities |

**Verdict:** suitable when the adopter owns the test browser and the reporting
workflow. Choose Argos when its hosted review/history surface is the required
outcome.

## Gate 3 — Chromatic

**Job:** treat Storybook as the UI catalog and turn stories into reviewable
visual checks.

| Requirement | Fit |
| --- | --- |
| Built or served Storybook | **yes** — `@variance-authority/storybook-collector` operates beside it |
| Story discovery and stable ids | **yes** — Storybook's index is the plan |
| Interaction/play completion | **yes** — collection waits for Storybook's rendered state |
| Local or remote render | **conditional** — the Storybook document does not archive resource bytes |
| Managed change selection | **partial** — source/baseline selection exists, without Chromatic's hosted module-graph service |
| Changed element resolved to `file:line` | **conditional** — a development Storybook needs nothing; a built, minified one is attributed to the line a component is *declared* on until its build carries `jsx-source`, `esbuild.jsxDev` and `keepNames` |
| Branch semantics and recorded sign-off | **partial** — a build carries the `branch` it was pushed from and every decision is recorded against the reviewer who made it; baselines do not follow a branch's merge base, and nobody is running the deployment for you |
| Non-engineer review surface | **partial** — the tribunal serves the review page and its identity provider decides who opens it; standing it up is an engineer's job, once |

**Verdict:** suitable for operator-owned Storybook capture, gating and review.
Choose Chromatic when the product being bought is somebody else running it —
branch baselines, managed stability, and a surface nobody on the team maintains.

## Unit-runner gate

**Job:** capture a mounted DOM in vanilla Jest or Vitest without running a browser
inside the unit process, then render pixels later.

| Requirement | Fit |
| --- | --- |
| Preserve runner primitives | **yes** — the unit surface exports no `test` or `expect` |
| Browserless acquisition | **yes** — `capture` reads the mounted DOM |
| Durable handoff | **yes** — `writeCapture` writes a versioned archive |
| Resource closure | **required** — external resources must resolve to immutable bytes |
| Later local browser | **yes** — `captureCollector` feeds the CLI renderer |
| Later remote browser | **yes** — the ordinary remote `Renderer` contract is interchangeable |
| Visual verdict inside jsdom | **no** — jsdom supplies no rasterizer |

**Verdict:** suitable for the two-step document-then-browser model. Vitest Browser
Mode with a Playwright provider belongs to the Playwright gate, not this one.

## Product boundaries

- Capture material is a document or an already-painted raster. A document is
  portable only when its resources are closed.
- The observation engine accepts both; the CLI currently collects documents.
- Storybook and route adapters never modify the host build or renderer.
- Playwright and unit adapters never replace the host's runner primitives.
- Managed review, managed browser/device fleets, and vendor contracts are outside
  the offering.

The composition and exact package choices are in [`surface.md`](surface.md).
