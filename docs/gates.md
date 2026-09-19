# Gate a build on what changed, and decide who runs the rest

A hosted visual-regression service bills per snapshot and keeps your baselines on
its side of the network. [Variance Authority](README.md) runs that comparison in
your own build job, against baselines in your own repository.

This page is for a team that pays Percy, Argos or Chromatic, or is about to. It
states how the build gate works — the command CI runs and the integer it reads
— and then walks each vendor's job and says which parts of it a self-run setup
takes over, and which stay vendor-only whatever you adopt: a managed device
fleet, reviewers the vendor staffs, and support commitments. For the wider
tradeoffs, see [how it compares](comparison.md).

New here? Start with [your first run](start.md).

## The gate

The gate is one command and one exit code. Install the CLI as a dev dependency
and run it in the job that builds the UI:

```bash
npm install --save-dev @variance-authority/cli
```

```yaml
- run: npx playwright install --with-deps chromium
- run: npx variance run --config variance.config.json
```

`npx variance run` exits `0` when nothing needs review, `1` when it found
something a person must look at, and `2` when the run did not happen as
configured — a missing browser, an unreachable store. A finding and a crash
never share a code, so a red build says which of the two it is before anybody
opens it. Gate on the integer; nothing parses the output.

Each state the run compares gets a **verdict** — the per-subject outcome
(`unchanged`, `changed`, `new`, `incomparable` or `ignored`). Six things take
the run to `1`:

| The run exits `1` when | Because |
| --- | --- |
| a subject is `changed` | pixels moved outside what you excluded |
| a subject is `new` | no baseline has been approved under that id yet, and a subject must not enter the suite unreviewed |
| a subject is `incomparable` | the baseline was painted under a different browser, platform, scale factor or font stack, so the comparison was refused rather than reported as agreement |
| a subject the run meant to observe failed | a subject that cannot be observed does not silently pass |
| two readings of one subject, seconds apart, disagreed and the subject's own declaration did not absorb that | otherwise the verdict is decided by whichever reading came first |
| an observation carries an `error` diagnostic | the run looked at less than the subject — a stylesheet it could not reach, say — so the images agree about something smaller than what you asked for |

Three things deliberately do not move it: an `ignored` verdict, where every
moved pixel fell inside a subtree you excluded; a subject your own configuration
excluded; and a `warn` diagnostic, which states a standing limit of the
configuration rather than a finding. All three are recorded either way; what
changes is whether they hold the build open.

Posting the result to the pull request is not part of the gate. `npx variance
comment` writes a comment body and posts nothing — the posting stays with
whichever commenting action you already use.

## What you would be running yourself

Percy, Argos and Chromatic each sell one subscription that bundles browser
capture, comparison and a hosted review page, with a managed browser fleet and
a support contract behind it. Variance Authority is not a hosted product. It is
a library and a CLI you run yourself. A **collector** — the adapter that knows
one host, such as a built Storybook or a served application — finds the
**subjects** that host has. A subject is one named UI state you asked for and
can ask for again, identified by a stable id like `story:checkout--empty`.
`npx variance run` captures each one, compares it against its baseline, and
writes a report you review where you like.

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
| Sitemap or crawler discovery | **partial** — `sitemap` reads a list the application publishes about itself; discovery by crawling is refused, so the subject list changes when you change it and not when a page's links change |
| Several widths | **yes** — each width is a distinct planned subject |
| Local or remote deferred render | **yes** — `portable: true` closes the collected document over the bytes the wire served |
| Vendor-hosted device and rendering fleet | **no** — engines and capacity are operator-owned |
| Hosted review UI | **partial** — `@variance-authority/tribunal` provides self-hosted review with per-subject decisions; [`npx variance push`](https://variance-authority.dev/reference/packages/cli) uploads runs using an operator-supplied review endpoint and ingest token |

**Summary:** Good fit when the suite has explicit routes or static pages and
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

**Summary:** Good fit when the team already owns the test browser and wants to
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
| Non-engineer review page | **partial** — [`@variance-authority/tribunal`](https://variance-authority.dev/reference/packages/tribunal), the self-hosted review application, serves the page and its identity provider decides who opens it; standing it up is an engineer's job, once |

**Summary:** Good fit when the team wants to operate Storybook capture, gating, and
review. Chromatic remains the better fit when branch baselines, managed
stability, and a maintained review page are part of the service you want.

## 4. Jest or Vitest jsdom workflow

**Job:** capture a mounted DOM in vanilla Jest or Vitest without running a browser
inside the unit process, then render pixels later.

| Requirement | Fit |
| --- | --- |
| Preserve runner primitives | **yes** — the unit package exports no `test` or `expect` |
| Browserless acquisition | **yes** — `capture` reads the mounted DOM |
| Durable handoff | **yes** — `writeCapture` writes a versioned archive |
| Resource closure | **required** — external resources must resolve to immutable bytes |
| Later local browser | **yes** — `captureCollector` feeds the CLI renderer |
| Later remote browser | **yes** — the ordinary remote `Renderer` contract is interchangeable |
| Visual verdict inside jsdom | **no** — jsdom supplies no rasterizer |

**Summary:** Good fit when a browserless unit process can hand a document to a
later browser. Vitest browser mode has its own path below.

## 5. Vitest browser-mode workflow

**Job:** observe a component that a browser-mode test already mounted, inside
the test that mounted it, without a second harness or a second run.

| Requirement | Fit |
| --- | --- |
| Preserve runner primitives | **yes** — the browser-mode package exports no `test` or `expect`, and the provider, mount library and locators stay the suite's |
| Verdict inside the test body | **yes** — the observation returns to the test over Vitest's command protocol |
| Acquisition in the frame that mounted the component | **yes** — markup, applicable CSS, provenance, wiring and resource bytes are read in the tester iframe |
| Viewport the component was laid out in | **yes** — media conditions resolve against the tester iframe, not the browser tab |
| Deferred, identified paint | **yes** — the Vitest process paints the captured document with a renderer that states its machine, scale and fonts |
| Pixels taken live in the tab that mounted it | **no** — a live screenshot carries no render identity, so its baseline is reproducible on no other machine |
| Approval from the runner's own flag | **yes** — `vitest -u` promotes the image the run already painted |
| Portalled markup rendered outside the read element | **no** — a mount whose interesting half is in a portal is read without it |
| The tab's own assistive tree | **no** — that reading comes from the Playwright path |

**Summary:** Good fit when component tests already run in a browser and the team
wants the verdict in the test body. The Playwright route remains the fit when
the state needs navigation, authentication, or the accessibility reading only a
driver-owned page supplies.

## 6. Responsibilities to plan for

- Capture material is a document or an already-painted raster. A document is
  portable only when its resources are closed.
- The observation engine accepts both; the CLI collects documents.
- Storybook and route adapters never modify the host build or renderer.
- Playwright, unit and browser-mode adapters never replace the host's runner
  primitives.
- Managed review, managed browser/device fleets, and vendor contracts are outside
  the offering.

[How the pieces compose](composition.md) and [which packages to install](surface.md)
cover the exact choices.
