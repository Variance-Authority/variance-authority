# Where Variance Authority fits

The right visual-testing setup depends on which responsibilities you want your
own team to run and which you want a vendor to run for you. Percy, Argos and
Chromatic each sell one subscription that bundles browser capture, comparison
and a hosted review surface, with a managed browser fleet and a support
contract behind it.

[Variance Authority](README.md) is not a hosted product. It is a library and a
CLI you run yourself: a **collector** per host finds the **subjects** your
suite has — the named things a run captures and compares, a Storybook story or
a route — and `variance run` captures each one, compares it against its
baseline, and writes a **report** you review where you like.

This page walks each vendor's job and says which parts of it that setup takes
over, and which stay vendor-only whatever you adopt: a managed device fleet,
reviewers the vendor staffs, and support commitments. For the wider tradeoffs,
see [comparison](comparison.md).

## 1. Percy route workflow

Percy is BrowserStack's hosted visual-testing product: an SDK or its Automate
browsers capture pages, Percy's cloud renders and diffs them, and its hosted
dashboard carries review.

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

**Verdict:** Good fit when the suite has explicit routes or static pages and
the team runs its own renderer and its own review instead of Percy's
vendor-hosted device fleet and hosted review UI. Percy remains the better fit
when managed browser breadth or hosted review is part of the job.

## 2. Argos-style test workflow

Argos is a hosted visual-testing product built around test suites you already
run: your own Playwright tests take the screenshots, and Argos compares them
and hosts review, comments, and flake history.

**Job:** capture screenshots from existing test environments, compare them, and
track review or flake history.

| Requirement | Fit |
| --- | --- |
| Additive Playwright capture | **yes** — native `test` and `expect` stay with Playwright |
| In-place page screenshot | **yes** — the page is screenshotted, then re-read; if nothing drifted between the two reads, that screenshot becomes the candidate raster, the pixels compared against the baseline. A subject that keeps repainting exhausts a retry budget and is refused instead of compared |
| Deferred render instead | **yes** — the same adapter can emit a document |
| Existing raster library input | **yes** — `observeRasters` and raster `CaptureArtifact`; a foreign image declares its painter, and two painters return `incomparable` rather than a wall of red |
| Arbitrary PNG CLI upload | **no** — the CLI has no ingest workflow |
| Renderer identity | **yes** — engine, platform, scale, fonts, stabilization, and launch recipe partition baselines |
| Hosted comments, reviewers, and flake register | **no** — those are Argos product capabilities |

**Verdict:** Good fit when the team already owns the test browser and wants to
operate the reporting workflow. Argos remains the better fit when hosted review
and history are part of the desired outcome.

## 3. Chromatic Storybook workflow

Chromatic is Storybook's own hosted visual-testing product: it builds and
renders your stories in its cloud, uses a module dependency graph to skip
snapshots a change cannot reach, and hosts review against branch baselines.

**Job:** treat Storybook as the UI catalog and turn stories into reviewable
visual checks.

When Variance Authority traces a changed pixel region back to source, it can
resolve it to the component's declaration, or further, to the exact JSX call
site that rendered the changed element. Resolving to a declaration needs no
extra instrumentation; resolving to the exact call site needs optional
`jsx-source` instrumentation. Choose the location precision you need.

| Requirement | Fit |
| --- | --- |
| Built or served Storybook | **yes** — `@variance-authority/storybook-collector` operates beside it |
| Story discovery and stable ids | **yes** — Storybook's index is the plan |
| Interaction/play completion | **yes** — collection waits for Storybook's rendered state |
| Local or remote render | **conditional** — the Storybook document does not archive resource bytes |
| Managed change selection | **partial** — source/baseline selection exists, without Chromatic's hosted module-graph service |
| Changed element resolved to `file:line` | **conditional** — a development Storybook needs nothing; a built one can resolve component declarations without extra instrumentation, while exact per-element call sites require optional `jsx-source` instrumentation and automatic development JSX emission; `keepNames` separately preserves component names |
| Branch semantics and recorded sign-off | **partial** — a build carries the `branch` it was pushed from and every decision is recorded against the reviewer who made it; baselines do not follow a branch's merge base, and deployment remains with the team |
| Non-engineer review surface | **partial** — the [tribunal](../packages/tribunal) serves the review page and its identity provider decides who opens it; standing it up is an engineer's job, once |

**Verdict:** Good fit when the team wants to operate Storybook capture, gating, and
review. Chromatic remains the better fit when branch baselines, managed
stability, and a maintained review surface are part of the service you want.

## 4. Jest or Vitest workflow

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

**Verdict:** Good fit when a browserless unit process can hand a document to a
later browser. Vitest Browser Mode with a Playwright provider follows the
Playwright route instead.

## 5. Responsibilities to plan for

- Capture material is a document or an already-painted raster. A document is
  portable only when its resources are closed.
- The observation engine accepts both; the CLI currently collects documents.
- Storybook and route adapters never modify the host build or renderer.
- Playwright and unit adapters never replace the host's runner primitives.
- Managed review, managed browser/device fleets, and vendor contracts are outside
  the offering.

The [composition](composition.md) and exact package choices are in [`surface.md`](surface.md).
