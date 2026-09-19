# Choose the operating model that fits

You are weighing Playwright's built-in `toHaveScreenshot`, Percy, Chromatic,
Argos, Applitools and [Variance Authority](README.md) against each other, and
their own pages do not agree on which axes decide it. This page sets the six
side by side on what each captures for a subject, where its pixels are painted,
who approves a diff, and what that costs in privacy, browser coverage and
money. [§6](#6-start-beside-the-tool-you-have) is where you install beside the
tool you already have.

**Decide first whether you want to operate it.** There is no hosted service, no
account, and no per-screenshot bill, and the price of that absent meter is that
you run the thing: compute, storage, renderer capacity, retention, upgrades and
the pager are yours. “No per-shot bill” is not the same claim as “free.” If you
want visual review delivered as a managed product — browser fleet, reviewer
seats, support contract — buy one of the four hosted products below, and §2 says
what each of them leads on.

Each comparison here is keyed by a **subject** — one named UI state you asked for
and can ask for again, such as `cart/empty`. Systems of this kind differ first in
what they capture for a subject, where its pixels are made, and who decides
whether a diff is approved. Those decisions determine privacy, browser coverage,
reproducibility, latency, and price more directly than the name of the test
runner adapter.

Two materials run through the table below. A **render document** is a subject's
DOM with its styles, its resources, and its component provenance, kept so that
pixels can be painted from it later and elsewhere. A **raster** is a screenshot:
pixels somebody has already painted. Every product here keeps one or the other,
and the choice decides where rendering can happen.

You are probably not choosing from an empty workspace. You already have a runner,
a way to get the app into important states, and some form of review. Keep the
parts that work, then compare the responsibilities that remain.

Those responsibilities decide what the practice costs. Visual review is paid for
twice: once in the meter, and once in the hours somebody spends deciding whether
a diff mattered. Both bills are driven by one quantity — how many comparisons
are shown to a person — and an architecture fixes that quantity long before a
report does.

Vendor documentation is authoritative for vendor behaviour. Verify pricing and
hosted-service features there before buying; both change independently.

## 1. Compare the responsibilities that matter

| Dimension | `toHaveScreenshot` | Percy | Chromatic | Argos | Applitools | Variance Authority |
| --- | --- | --- | --- | --- | --- | --- |
| Acquisition | Playwright screenshots the page or locator inside the running test | SDK captures the DOM and its resources, or Automate captures the running browser | Storybook or E2E archive | Host adapters open a page and Playwright produces screenshots | Classic SDK captures in place; Ultrafast Grid captures a DOM snapshot | Storybook, routes and unit tests keep a render document; Playwright keeps a document or takes a screenshot in place |
| Pixel placement | Caller-owned browser | Percy cloud, or the Automate browser | Capture Cloud | Caller-owned browser | Caller browser or Ultrafast Grid | Caller-owned browser, local renderer, or a renderer you host |
| Review | PNG files in your repository, reviewed in the pull request that changes them | Hosted dashboard and approval workflow | Hosted UI Test and UI Review | Hosted test review, comments, and flake history | Eyes Test Manager | `tribunal`, a review service you deploy — builds, docket, region overlays, recorded decisions, which `variance push` posts runs to; or no service at all, and the same evidence as JSON, HTML, CLI output or MCP |
| Browser breadth | Whatever your Playwright projects run | Managed desktop and mobile coverage | Managed browser and mode matrix | Whatever the caller's capture suite runs | Managed grid plus mobile products | Whatever the caller's capture suite runs; the CLI paints with Chromium, Firefox or WebKit (§3.2) |
| Source [attribution](attribution.md) | Test name and snapshot path | DOM and CSS root-cause aids | Story identity and dependency tracing | Spec and story metadata | DOM and CSS root-cause aids | Pixel region → component → `file:line`, when the capture supplies [matching provenance](attribution.md) |
| Compared against | The committed snapshot file | The approved baseline | The approved baseline | The approved baseline | The approved baseline | The baseline. Also, within a single run: two related states, compared for the gap between them; and one input rendered twice, compared for the point where the two renderings diverge |
| What a run captures | The assertions the tests you ran reached | The states your test code calls `percySnapshot` on | Stories and archived runs; TurboSnap uses the module graph to avoid snapshots a change cannot reach | The screenshots your suite takes | The checkpoints your SDK calls make | `--since` skips a subject when its baseline lists none of the components the change reached — stories, routes and Playwright subjects alike. Instrumented test runs also select test files by what they executed |
| Operations | Adopter | Vendor | Vendor | Vendor, with an open-source self-host option outside the supported service contract | Vendor or contracted on-premise deployment | Adopter |

The capture row divides on one axis: what a change imports versus what its tests
executed. TurboSnap reads the static module graph, and Variance Authority's
optional file graph is the same family of thing — a specifier scan over `import`,
`require`, `@use` and `url()` — which answers only the file-to-component half.
What decides a skip is the other half, and it is not a prediction: a stored
baseline records the components the document that painted it actually rendered,
so a subject is skipped because the last run established what it is made of.
The same [execution index](execution-record.md) answers the inverse question
through a function called `coveringTests`: given a source line or function, it
returns the individual tests that executed it, nearest call stack first.
[Wallaby.js](https://wallabyjs.com/) keeps an execution index of this kind for
its own editor tooling; here the index decides which subjects a run skips.

Variance Authority works beside an existing Playwright Test suite, a built or
served Storybook, served routes or a static directory, Jest or Vitest under
jsdom, and Vitest browser mode; any other host composes the observation library
directly. [§6](#6-start-beside-the-tool-you-have) names the package for each, and
[how a suite connects](surface.md) covers the material and placement each one
produces.

### Account for both compute and review

Hosted products meter different units. Percy and Argos count screenshots;
Chromatic counts snapshots with product-specific multipliers; Applitools defines
a Page independently of browser and device repetitions. A useful estimate starts
with the vendor's unit, not with a raw subject count:

```text
subjects × viewports × browsers × modes × selected builds
```

The same multiplication drives the other bill. Every comparison that survives to
a person is a decision somebody makes, and a suite that surfaces more than it
should is a standing assignment rather than a test run.

What separates the products is where intelligence sits relative to the spend.
Perceptual match levels and hosted review queues read a comparison that has
already been captured, rendered, and metered, so they change the review bill
rather than the meter. TurboSnap prunes earlier — before the capture, from the
static module graph.

This project prunes twice, and neither prune is a prediction. `--since` skips a
subject when its stored baseline lists none of the components the change reached,
so the skip rests on what the last run recorded the subject to be made of. What
survives is then decided at the cheapest representation that can decide it (§3.3):
structure, semantics, authored CSS, and provenance settle a question without a
raster, and raster comparison runs for the questions that need pixels. One path
deliberately spends more: in-place capture takes repeated agreeing screenshots to
classify same-run instability, which buys an answer rather than a saving.

Variance Authority has no vendor meter. Compute, storage, renderer capacity,
retention, upgrades, and operational labour belong to the adopter. The software
itself is free of charge and MIT-licensed: every package publishes to npm under
that licence, and the licence grants use, modification and redistribution,
including commercially. What you pay is the machines and the hours in §4.

Sources: [Percy plans and billing](https://www.browserstack.com/docs/percy/overview/plans-and-billing),
[Chromatic billing](https://www.chromatic.com/docs/billing/),
[Argos pricing](https://argos-ci.com/pricing), and
[Applitools terms](https://applitools.com/terms-of-use/).

## 2. Where the other products lead

### Playwright's `toHaveScreenshot`

You may already have it, and it costs nothing to keep. Baselines are PNG files in
a `<test-file>-snapshots` directory beside the test; `npx playwright test
--update-snapshots` rewrites them; the filename carries the browser and platform
(`example-test-1-chromium-darwin.png`), so a Linux CI image and a macOS laptop do
not fight over one file. Tolerance is a number — `maxDiffPixels` and its
neighbours, set per assertion or once under `expect.toHaveScreenshot` in the
config.

Choose it when "these pixels moved" is the answer you want, reviewed in the same
pull request as the code, with no service to run and nothing new to learn.
Variance Authority's Playwright package sits beside it rather than replacing it:
`test` and `expect` stay Playwright's, and the two assertions can run in the same
test while you compare the answers.

Sources: [visual comparisons](https://playwright.dev/docs/test-snapshots).

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
reviewers. TurboSnap uses the module graph to avoid snapshots a change cannot
reach. SteadySnap adds render stabilization and repeated-capture techniques
within the managed service.

Component isolation is a choice you make rather than a limit the product
imposes: a page-level story and an archived end-to-end flow both land in the
same review surface. An archive is repainted after the run that recorded it has
ended, so what it can answer later is fixed at the moment of capture.

Choose Chromatic when review should be a product — Storybook inventory, E2E
archives, or both — and non-engineer review, branch semantics, and managed
stability matter more to you than self-operation.

Sources: [Storybook workflow](https://www.chromatic.com/docs/storybook/),
[Playwright visual tests](https://www.chromatic.com/docs/playwright/),
[TurboSnap](https://www.chromatic.com/docs/turbosnap/), and
[SteadySnap](https://www.chromatic.com/features/steadysnap).

### Argos

Argos keeps rendering in the caller's browser. Its Playwright primitive captures
in place, and the Vitest and Storybook quickstarts are thin host compositions
over that browser capture, followed by upload.

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

## 3. What Variance Authority makes independently configurable

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

See [from a pixel to a line](attribution.md) and [the source
scan](source.md).

### 3.2 Capture material, rendering placement, and which engine paints

A run keeps one of the two materials named at the top of this page, and both
land in the same comparison.

A **render document** can be painted later. It is *portable* once every resource
it needs travels inside it, which means any machine can paint it; it is
*environment-dependent* while it still has to fetch from the origin that
served it, which means only a machine with that access can paint it. Either way
the paint happens locally or across a renderer you host.

A **raster** is already painted. It skips rendering entirely and joins the same
durable comparison path.

**Chromium, Firefox and WebKit all paint.** A subject's `browser` key is one of
the three and defaults to `chromium`; `npx playwright install <engine>` is what
adds one. The engine is part of the renderer identity a baseline is filed under,
so approving a Chromium baseline does not approve the WebKit one — a run that
meets a baseline painted by another engine reports the pair `incomparable` and
names both engines instead of diffing them.

Two capabilities are Chromium's alone, and that is a position rather than a gap
to be closed. Text rasterization is pinnable on Chromium only:
`--disable-lcd-text` and `--font-render-hinting=none` are flags no other engine
accepts, so Firefox and WebKit paint text the way the host does and their rasters
belong to the host that made them — give them one host, or a container image, and
keep it. And the engine-located half of source attribution reads
`[[FunctionLocation]]` over the Chrome DevTools Protocol, which Chromium alone
provides; under the other two engines the source scan answers on its own, with
its candidates unnarrowed, and the run claims nothing it could not see. The
stabilization recipe is likewise written against Chromium's behaviour.

Renderer identity covers engine, platform, scale, fonts, stabilization, and the
rasterization recipe, which is why the pair above is reported rather than
compared.

The resulting adopter surfaces are compositions rather than separate products:

- Storybook and routes: browser acquisition → environment-dependent document →
  local render or a hosted renderer with equivalent resource access → shared
  observation.
- Jest or Vitest jsdom: browserless acquisition → portable archive → later CLI
  process → local or hosted render → shared observation.
- Playwright Test deferred: caller locator → environment-dependent document →
  renderer with equivalent resource access → shared observation.
- Playwright Test in place: caller locator → repeated agreeing screenshots →
  raster → shared observation.

### 3.3 Deciding at the cheapest representation that can decide

Structure, semantics, authored CSS, and provenance do not require a pixel render.
Raster comparison runs only for questions that need pixels. Content-addressed
documents and render caches make that separation useful across reruns.

A comparison sorts what changed into five **bands** — `a11y` (accessible name,
role, ARIA state), `geometry` (position and size), `token` (design-token values),
`content` (text), and `texture` (raster residue with no document counterpart).
The band is what a report names when it says which *kind* of thing changed, and
[sensitivity](sensitivity.md) is where a subject declares which bands it asserts
on. A band the run could not observe is reported `unobserved`; it is not
converted into an empty result or a pass.

The two capture paths trade against each other. In-place capture avoids a second
browser but takes repeated screenshots to classify same-run instability. Deferred
capture pays archive and rendering costs but gains placement freedom and cache
reuse.

See [how the pieces fit together](architecture.md), [the evidence
instruments](instruments.md), and [how an unstable subject is
found](flakiness.md).

### 3.4 Comparisons that need no prior good state

Every product in §1 compares a subject against its approved baseline, which
answers one question: did this change since the last time somebody said it was
right. Two comparisons here answer different questions, and neither consults
history.

A subject declared as a [variation](variations.md) of another — by tagging its
subject plan `variance-parent:<the other subject's id>` — is compared against the
subject it varies, in the same run. The run prints the pair:

```text
story:checkout--new-flow ← story:checkout--default (content, structure)
  `story:checkout--new-flow` differs from `story:checkout--default` in content
  and structure, led by `Checkout`. The difference is `v1:9f2a11c4e77b`, and it
  is unchanged for as long as the two subjects keep moving together.
  components: Checkout, Button
```

That hash is taken over the difference between the two subjects, not over either
subject. A token edit that repaints both of them leaves it exactly where it was,
and it changes only when the variation gains or loses something its parent does
not have. So *everything changed and the flag still does what it did* arrives as
a hash that did not change, and *the flag now does something else* arrives as a
hash that did — a distinction a reviewer otherwise draws by hand, on every diff.
Nothing on this axis changes the exit code, the baseline store, or what
`variance accept` does. See [subjects that are other subjects on
purpose](variations.md) and [the suite compared to itself](composition.md).

A changed subject is also read a second time, and there are two second readings.
`again` holds the world and advances time; `alone` rebuilds the world and holds
time. Neither is a retry and neither consults a baseline: each compares two
readings of one input. The order is load-bearing — `again` runs first, because
`alone`'s inference is *the clean reading differs from the shared one, so the
world changed it*, which is only evidence once two readings of one world are
known to agree. A run re-collects at most `alone.limit` changed subjects this
way.

Because a document carries a hash per component per band, the answer is not
"this subject is flaky", which is a page to re-examine. It is a component and a
band:

```text
[unstable] story:checkout--summary — Clock read differently (content)
```

`content` is data, `geometry` is layout that has not settled, `token` is a style
still being applied. That is what a fix can be aimed at. See [how an unstable
subject is found](flakiness.md).

Both of these cut the same bill, and it is the labour one. A difference a hash
has already settled, and one already named as an unstable component, are
two things nobody is asked to look at twice.

## 4. Operational boundaries

Adopter operation is what the absent meter is bought with. Variance Authority
provides libraries and a CLI for infrastructure you operate, and the arrangement
that removes the per-shot bill is the same one that puts compute, storage,
renderer capacity, and the pager on your team. It does not provide a managed
browser fleet, hosted reviewer accounts, a support SLA, contractual data
residency, or vendor-operated retention.

**What you are installing.** Every package is MIT-licensed, published to npm
under the `@variance-authority` scope, and the licence grants use, modification
and redistribution, including commercially. They share a single version line —
`0.2.0` across the CLI, the collectors, the Playwright package and the review
service — so the pieces change together and a half-upgraded install is not a
state you can arrive in. The repository and these pages are the support.

That ownership is also where data placement is decided. Remote rendering and
storage use operator-supplied endpoints. Portable documents may cross that
boundary; in-place raster capture can keep DOM material inside the test
environment and send only pixels to later systems.

The CLI supports Storybook, explicit routes and static directories, artifact-backed
unit capture, and custom collectors. The additive Playwright package operates
inside the suite and leaves `test` and `expect` with Playwright. Raster input is a
library seam — `observeRasters` in `@variance-authority/observe`, or a raster
handed to the capture path.

**The baseline store is a directory.** Approved images and their per-component
sidecars are written to a filesystem path, either plain or with the images
tracked by git-LFS so they arrive with a branch. Because it is a directory,
`actions/cache` restores one and `aws s3 sync` mirrors one. The other option is
HTTP: point the run at a `tribunal` deployment and it reads and writes baselines
there instead.

**`tribunal` is a service you deploy, and it is optional.** It is a `fetch`
handler with a database and an object store behind it: on Cloudflare that is a
Worker over D1 and R2, and on a machine you own it is a Node process over
`node:sqlite` and a directory, started by the executable the package ships. The
same router runs in both. Skip it entirely and a run still reports — JSON, HTML,
CLI output, or an MCP server — and review happens wherever your team already
reads CI.

**Parallelism is your runner's.** `concurrency` sets how many subjects one run
holds in flight. Past one machine you shard the suite the way you already shard
the test suite, then `variance report shard-1.json shard-2.json …` merges the
shard reports into one build for `variance push` to post. Wall clock is whatever
your own capacity buys; there is no fleet to fan out onto.

**Review by someone who does not run the suite means deploying `tribunal`.** It
takes two secrets that must differ: an ingest token CI posts builds with, and a
review token that reads the review surface and decides. It ships no accounts, no
sign-in, and no permission model — the adapter you mount it behind authenticates
the person and attaches the capability to each request. A designer clicking
approve is a deployment you configure, not a seat you buy.

**Approved baselines from another tool do not transfer.** A baseline here is a
PNG plus a sidecar of per-component, per-band hashes, filed under the identity of
the renderer that painted it. Images approved in a hosted service carry neither.
`observeRasters` will compare two foreign images that declare the same painter,
but a foreign image against a locally rendered candidate is `incomparable`.

So your first run reports `new` on every subject, and that is the adoption moment
rather than a failure: nothing has been compared yet. Open the report, check the
candidates are the states you meant, and accept them — `variance accept
<subject-id>` for one, `variance accept --all` to seed the whole suite in a
single decision, or Playwright's snapshot update flag inside an existing
Playwright suite. Acceptance promotes exactly the image that run produced and
never renders a replacement, so what lands in the store is what you looked at.
The next run reports `unchanged`, and from there `--all` stops being the right
habit: name the subjects you decided on. The approval history you built elsewhere
stays where it is.

## 5. Choose the ownership model you want

Percy, Chromatic, Argos, and Applitools supply managed browser coverage, hosted
review links, and vendor support. Choose one when you want visual review as a
managed product and do not want to own renderer images, storage, upload paths,
and their operational support. Choose `toHaveScreenshot` when a pixel count in
the pull request is the whole answer you need.

Choose Variance Authority when a changed screenshot should arrive as one cause
with its evidence and be settled in one decision — and when component and source
attribution, explicit evidence boundaries, and local or operator-controlled data
placement are worth the operation they cost.

## 6. Start beside the tool you have

Nothing here asks you to switch the other tool off. Add one subject, run it next
to the suite you already trust, and compare the two answers on a real diff.

Install the package for the host that already gets the app into the state. For
an existing Playwright suite:

```bash
npm install --save-dev @variance-authority/playwright-test @playwright/test
npx playwright install chromium
```

For a host the CLI drives — a built or served Storybook, here:

```bash
npm install --save-dev @variance-authority/cli @variance-authority/storybook-collector
npx playwright install chromium
```

Swap the collector for `@variance-authority/route-collector` for served routes or
a static directory, `@variance-authority/unit-test` for Jest or Vitest under
jsdom, `@variance-authority/vitest-browser` for Vitest browser mode, or
`@variance-authority/observe` to compose your own. Playwright's browser binaries
do not arrive with an `npm install`, which is what the second line is for.

[Take one subject through the loop](start.md) runs the first cycle end to end:
the first run reports `new`, `variance accept <subject-id>` promotes the image
that run produced, and the next run reports `unchanged`.
