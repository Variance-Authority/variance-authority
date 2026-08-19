# Comparison

For engineers deciding whether the attribution approach in
[§3.1](#31-a-diff-that-names-a-component-and-a-file) is worth tracking. It is not
a pitch to adopt anything: [§5](#5-when-not-to-choose-this) names which product to
buy instead, and for most readers the answer is one of the four.

**Vendor pricing and features move.** Every figure about a competitor was read
from that vendor's own pages on 2026-08-02 and carries a link; re-verify before
relying on any of it. A claim that a competitor *lacks* something reads "not
documented as of 2026-08-02" and cites the page searched — absence from
documentation is not absence from a product, and a feature may live at the
test-runner layer rather than the vendor's. Every number attributed to this
project carries the file that produces it and is marked **measured** or
**claimed** accordingly.

## The asymmetry, stated first

Percy, Chromatic, Argos and Applitools are products. They have customers, uptime
commitments, support contracts, browser fleets, and years of production contact
with codebases nobody on their team wrote. Variance Authority is an M0 spike. It
has never been run against a repository that is not its own.

The specific consequences, so they are not left to be inferred:

| They have | This has |
|---|---|
| Chrome, Firefox, Safari, Edge, mobile emulators or real devices | Chromium, Firefox and WebKit, all three run, on one document. One font stack, `color-scheme: light` pinned |
| A hosted dashboard designers and PMs use without repo access | A JSON report and seven MCP tools |
| Years of contact with third-party component libraries | One corpus, written by the same people who wrote the implementation |
| Support, SLAs, and someone to call | A git repository |
| MIT (Argos), or a commercial contract legal can sign | MIT, with nothing published under it. A root `LICENSE` and 23 non-private manifests at `0.0.0-beta.1` make the packages licensed and publishable; no `v*` tag has ever been pushed, so no registry has seen one and obtaining this still means cloning the repository ([spec 0015](specs/0015-the-first-published-release.md)). A reader evaluating it for adoption should read the rest as a description of an approach rather than of something installable |
| A working install path: `npx`, a token, a green check on a PR | A CLI executed end to end against one Storybook this project did not write, and against nothing else ([§4](#4-what-is-written-and-unrun)) |
| Linux CI, verified by every customer who runs it | Every measurement in this repository from one M-series Mac |

Anything below that reads as an advantage should be read against this table. The
axes where this project is different are narrow, and most of the category's
surface area is not one of them.

---

## 1. The dimensions a buyer actually decides on

| | **Percy** (BrowserStack) | **Chromatic** | **Argos** | **Applitools** | **Variance Authority** |
|---|---|---|---|---|---|
| **Integration surface** | 20+ SDKs: Selenium, Playwright, Cypress, Puppeteer, Storybook, Appium; plus no-code URL list, sitemap, static dir, crawler ([SDKs](https://www.browserstack.com/docs/percy/overview/supported-sdks)) | Storybook first-class (stories become tests with no authoring), plus Playwright, Cypress, Vitest ([docs](https://www.chromatic.com/docs/storybook/)) | Playwright, Vitest, Storybook, Cypress, WebdriverIO, Puppeteer, plus a CLI that takes any PNG ([docs](https://argos-ci.com/docs/overview.md)) | 30+ SDKs across five languages, native mobile, Tosca, Katalon ([docs](https://applitools.com/docs/eyes)) | **Three shipped surfaces, and the gap to the left is still wide.** Theirs consume an existing suite's output across 20–30 SDKs. Here there are three: a **built or served Storybook** through `@variance-authority/storybook-collector` (five lines of config); a **Playwright suite** through `@variance-authority/playwright-test`, where the test body you already wrote plays the collector's part without replacing its runner imports — `assertUnchanged(await observe(page, locator, testInfo))`; and a **map of served URLs** through `@variance-authority/route-collector`, which is also the first thing to enter through `subjects.kind: "list"`. Anything outside those three is re-mounted by a collector the operator writes, and the honest measurement of writing one is 341 lines. For Cypress, WebdriverIO, Appium or a sitemap that is the cost — and the route collector is **not a crawler**: the URLs are a map the operator writes, because a discovered page is a subject nobody chose. Also built: a library callable inside Vitest/Jest via jsdom. Provenance from React fibers, or from **two `data-*` attributes any build step can emit** ([§3.1](#31-a-diff-that-names-a-component-and-a-file), [surface.md](surface.md)) |
| **Where rendering happens** | Vendor. DOM serialized in your browser, re-rendered server-side across browsers/widths, **JS disabled by default** ([workflow](https://www.browserstack.com/docs/percy/integrate/percy-sdk-workflow)) | Vendor "Capture Cloud". Storybook bundle or E2E archive uploaded and re-rendered ([docs](https://www.chromatic.com/docs/snapshots/)) | **Customer CI.** Argos never launches a browser; it receives PNGs and diffs them ([docs](https://argos-ci.com/docs/overview.md)) | Vendor. Ultrafast Grid re-renders a DOM snapshot in containers; mobile is emulated/simulated ([UFG](https://applitools.com/docs/eyes/concepts/test-execution/ultrafast-grid)) | **Customer, everywhere.** jsdom in the unit-test process, or a browser the run owns — Chromium, Firefox or WebKit, chosen per renderer. Optional remote renderer the operator runs |
| **Cost model** | **Per screenshot** = page × browser × width. Free 5,000/mo; Desktop $199/mo annual → 10,000, overage **$0.036** ([pricing](https://www.browserstack.com/pricing?product=percy)) | **Per billed snapshot** = tests × builds × browsers × modes; TurboSnap = 0.2. Free 5,000/mo; Starter $179/mo → 35,000, overage **$0.008** ([billing](https://www.chromatic.com/docs/billing/)) | **Per screenshot.** Free 5,000/mo; Pro from $100/mo → 35,000, overage **$0.004** ($0.0015 Storybook). SSO priced separately ([pricing](https://argos-ci.com/pricing)) | **Per Page** = a unique checkpoint *regardless of browser, device or version*. No public price at any tier ([pricing](https://applitools.com/pricing/), [ToS](https://applitools.com/terms-of-use/)) | No unit. Compute is the operator's; storage is a directory, git-LFS or a remote endpoint the operator runs. Sized below — estimated from measured per-image bytes, not read off a bill |
| **Flakiness handling** | Determinism up front — JS off, GIFs frozen, CSS animations frozen ([animations](https://www.browserstack.com/docs/percy/stabilize-screenshots/animations)) — plus manual suppression. No per-snapshot flake rate, quarantine or retry documented as of 2026-08-02; retries may exist at the test-runner layer instead | SteadySnap: render stabilization, Burst Capture (multiple renders, pick most stable), freeze frame, **auto-migrated baselines across their own browser upgrades** ([SteadySnap](https://www.chromatic.com/features/steadysnap)) | **Diff fingerprints.** An ignore is a (test, diff-shape) pair; auto-ignore after N occurrences in 7 days; flakiness score 0–100 per test; an Ignored register with occurrence counts ([docs](https://argos-ci.com/docs/learn/reliability-and-flakiness/flaky-test-detection.md)) | Perceptual matching, six match levels, floating/ignore/layout regions, DOM-anchored ignore regions, `MatchTimeout` 2s retry. No cross-run flake score documented as of 2026-08-02 ([match levels](https://applitools.com/docs/eyes/concepts/best-practices/match-levels)) | **No quarantine and no retry, and a flake rate that divides by the runs that asked** ([flakiness.md](flakiness.md#has-this-happened-before)): a changed subject is read twice in one run, an occurrence is recorded with the component and band that moved, and a window reports occurrences, a rate over the sweeps that could have observed one, and how many sweeps have been clean since. Nothing is auto-ignored at any threshold, which is the remaining difference from the cell to the left — less *mitigation*, not less *data*. Underneath both is a classification of causes by what absorbs them — construction, environment key, policy, or **nothing** — and [flakiness.md](flakiness.md) names the four absorbed by nothing. Cross-pollution is attributed to a named writer rather than suppressed. That is a position, not a mitigation |
| **Attribution: does a diff name a component and a file?** | **No.** Root Cause Analysis names the changed element's CSS class, or its tag if it has none. No component, no file, no commit ([RCA](https://www.browserstack.com/docs/percy/root-cause-analysis/overview)) | **Component yes, by construction; file no.** A snapshot *is* a story, so the story title names the component. For a page-level story the answer is "this page moved". `npx chromatic trace` walks the module graph file→story offline — the same category of offline repo lookup this project's own last hop uses, pointed the other way ([trace](https://www.chromatic.com/docs/turbosnap/trace-utility/)) | **No.** Metadata carries the *test spec's* file and line (`tests/home.spec.ts:42:3`) and the Storybook story id. No component field and no map from a diff to product code in the documented metadata ([metadata](https://argos-ci.com/docs/reference/screenshot-metadata.md)) | **No.** RCA names DOM elements and changed CSS properties with a DOM path. GitHub status Details links go to the Test Manager, not to source ([RCA](https://applitools.com/docs/eyes/concepts/reviewing-tests/root-cause-analysis)) | **Yes, measured on one corpus**: pixels → regions → components → `file:line`, ranked from the semantic tier. Two provenance adapters — React fibers, and 25 lines reading `data-component`/`data-props`, which is what a Vue or Svelte build step already emits. The `cause`/`collateral` ranking rests on one mutation, one story, one self-authored example app, one machine ([§3.1](#31-a-diff-that-names-a-component-and-a-file)) |
| **Review and approval** | Dashboard approval persisting across a branch's lifespan, snapshot rules that persist to future branches, **unlimited users on every tier including Free** ([approval](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/approval)) | UI Test and UI Review as separate checks, assigned and persistent default reviewers, threaded discussion anchored to an individual snapshot, no repo access required for designers ([review](https://www.chromatic.com/docs/review/)) | Multiple independent reviewers, comments pinned to an exact pixel or line range, a full keyboard path, per-test discussion threads ([test page](https://argos-ci.com/docs/learn/reliability-and-flakiness/test-page.md)) | Triage grouped by the *shape* of the diff, one accept propagating across the batch ([maintenance](https://applitools.com/docs/eyes/concepts/reviewing-tests/test-maintenance)) | **The axis this loses hardest, and the one these products are bought for.** `variance accept` promotes a candidate the run already produced and records one approval row per `(subject, run)`, and stops there ([§4](#4-what-is-written-and-unrun)). No UI, no reviewer model, no discussion, no merge semantics for two branches accepting differently |
| **Accumulated history** | Approval persists across a branch's lifespan; snapshot rules persist; 30-day (Free) / 12-month (paid) build history. **No longitudinal per-snapshot metric** ([approval](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/approval)) | Per-branch baselines with branch-point inheritance, squash/rebase detection via git provider APIs, browsable baseline revision history. Retention unpublished below Enterprise ([branching](https://www.chromatic.com/docs/branching-and-baselines/)) | **The strongest in the category.** Per-test flakiness over 24h–90d windows, changes grouped by fingerprint and ranked by recurrence, first/last seen, per-test discussion threads, account analytics with CSV ([test page](https://argos-ci.com/docs/learn/reliability-and-flakiness/test-page.md)) | Baselines keyed by app × test × OS × browser × viewport, with revision history, branch baselines and a merge UI; Insights charts. 1-year retention stated on Public Cloud only ([baselines](https://applitools.com/docs/eyes/getting-started/applitools-workflow/baselines)) | Per-component band hashes, the design tokens a subject resolved, and instability occurrences — append-only, no pixels. **A run writes the rows and asks about them in the same pass**, and both halves answer: occurrences, a rate over the sweeps that could have observed one, first and last seen and sweeps-since on the flake side; on the drift side `variance accept` records the acceptance and the report says how far a token has travelled across every approved change in the window. All of it reads and writes a history service the operator deploys, and that service is written and unrun — see [§4](#4-what-is-written-and-unrun) |
| **Self-hosting** | **None, and the architecture forecloses it** — the SDK's function is to ship your DOM to Percy's API. "Automate Self-Hosted" is a different product | **None.** "On-premises" in their docs means self-hosted *git providers* ([FAQ](https://www.chromatic.com/docs/faq/chromatic-sso-on-premises-other-git/)) | MIT-licensed in full, **and the vendor states self-hosting "is not officially supported or documented"** — needs Postgres, RabbitMQ, Redis, S3, DynamoDB, a GitHub App and Stripe ([docs](https://argos-ci.com/docs/overview.md)) | **Yes** — on-premise Eyes server, images stored locally; also private dedicated cloud ([modes](https://help.applitools.com/hc/en-us/articles/360007189231-The-different-deployment-modes), ~7 years old). Scoped to Eyes, not Autonomous | Nothing hosted exists, so nothing has to be opted out of: no telemetry, no phone-home, one outbound call to a renderer endpoint the operator supplies. That is not the same as a self-hosting *story* — nothing published to install from (see the table above), no upgrade path, no backup story, and the history service is one SQLite file behind a bearer token, which is one process to run and one file to back up ([§4](#4-what-is-written-and-unrun)) |
| **Data residency** | Geo Region Restriction, **Enterprise plan only, via an Account Executive**; metadata such as test names stays in the default region regardless ([GRR](https://www.browserstack.com/docs/enterprise/security/geo-region-restriction)) | **Undocumented publicly.** No stated provider, region, or EU option; SOC 2 Type 2 and 99.9% SLA are stated ([security](https://www.chromatic.com/security)) | **US only.** S3 in the US under Standard Contractual Clauses; no documented EU option. SOC 2 Type II ([security](https://argos-ci.com/security)) | Customer-selectable data-centre location including EU on Azure or customer premises; ISO 27001. GDPR page last updated May 2021 ([GDPR](https://applitools.com/legal/gdpr/)) | The operator's network, and the operator's compliance work. Nothing leaves that network, but that is the operator's claim about their own infrastructure, not an attestation: no SOC 2, no ISO 27001, no DPA, no retention policy, no deletion path, no pen test, no auditor has ever read this code. Residency becomes a question about the operator rather than an answer ([§5](#5-when-not-to-choose-this)) |
| **Maturity** | Mature, broad, backed by BrowserStack | Mature; built by the Storybook maintainers | Mature enough to run production suites; small team, key-person concentration | Mature, enterprise sales motion, some docs 7–8 years old | **`0.0.0-beta.1`, MIT, no support contract.** Maturity is read off the repository rather than asserted in this row: every limb that is not written and every defect in code that ships is a marker at the line that owns it, and `yarn unrun` prints them with `file:line` ([§4](#4-what-is-written-and-unrun)) |

### The one commercial fact worth isolating

The category's pricing unit multiplies against the coverage the tool exists to
provide. Percy states it directly: "two pages rendered across two browsers and
three widths would result in twelve screenshots"
([pricing FAQ](https://www.browserstack.com/pricing?product=percy)). Chromatic
publishes the formula: `tests × builds × browsers × modes`
([billing](https://www.chromatic.com/docs/billing/)). A 200-component library at
3 viewports × 4 browsers is 2,400 raw units per full run.

**The discount is part of the arithmetic.** Chromatic's TurboSnap bills a
turbosnap at 0.2, which its own pricing page states as an equivalence: the free
5,000 is "equivalent to 25k turbosnaps" and Starter's 35,000 to 175k
([pricing](https://www.chromatic.com/pricing/)). Percy and Argos have no
equivalent multiplier, so 2,400 is their real figure and the 5,000/month free
tier is worth about two runs there — and about ten on Chromatic.

The reader this section is aimed at is not on a free tier. The same library at
100 PR builds a month is 240,000 raw units. On Chromatic Starter — $179/mo,
35,000 included, $0.008 overage — TurboSnap brings that to 48,000 billed, so the
bill is about **$283/mo**; without TurboSnap it is roughly $1,800. On Argos Pro
($100/mo, 35,000 included, $0.004 standard / $0.0015 Storybook) the same 240,000
screenshots run about $920, or $407 at the Storybook rate. Chromatic Starter and
Argos Pro genuinely include the same 35,000 — both read on 2026-08-02, and that
is not a transcription slip. **$283/mo is the number this project would have to
beat, and it is not a large number.** The multiplication bites at scale, at high
run frequency, or where TurboSnap does not apply — cases its own documentation
enumerates, including any change to `preview.js`'s import graph or to Storybook
configuration ([TurboSnap](https://www.chromatic.com/docs/turbosnap/)).

Applitools is the exception and it is a real architectural difference, not
marketing: the ToS defines a Page as "a unique Checkpoint regardless of how many
times the Checkpoint is executed, and regardless of the browser, device, or
browser version" ([ToS](https://applitools.com/terms-of-use/)). Coverage breadth
is free there. It is offset by no published price at any tier, and — on a reading
of the ToS this document has not been able to quote verbatim, so treat it as
unverified — a ceiling of 1,000 checkpoints per Page per month sitting underneath
the "unlimited test executions" line on the pricing page.

Variance Authority has no unit because it has no vendor, and naming that bill
without sizing it is a way of not saying a number. Sized — **estimated, never
operated** — the same 600 subjects (200 components × 3 viewports; no browser
axis, because there is one Chromium) cost about 4.5 CI-seconds of warm semantic
capture at the measured 7.5 ms, plus about 39 seconds if every subject also
reaches the raster tier at the measured 65.4 ms per screenshot — neither figure
asserted by any test
([§3.3](#33-deciding-at-the-cheapest-representation-that-can-decide)). With
browser install, checkout and build, a run is single-digit CI-minutes: cents at
any runner price. **The compute is not the bill.** Durable baseline storage
is sized here from per-image bytes rather than from a measured store. The bill is
the engineering time to finish the unrun work in
[§4](#4-what-is-written-and-unrun) and then operate it, and this document puts no
range on that, because a range would be invented. That is the comparison: a known
$283/mo against an unknown engineering commitment.

---

## 2. What each competitor does better than this project

### Percy

- **Cross-browser rendering from one capture.** Serialize the DOM once in one
  browser, get Chrome, Firefox, Safari and Edge renderings server-side, off the
  CI critical path. This project renders one engine per renderer, has run two of
  the three it offers, and has no cross-browser *arm* — no grid, no matrix run
  — which is a large fraction of what real VR spend buys.
- **Deterministic-by-default rendering, including the parts CSS cannot reach.**
  JS disabled on re-render and animated GIFs frozen on the first frame
  ([animations](https://www.browserstack.com/docs/percy/stabilize-screenshots/animations)).
  Percy can disable JavaScript because it re-renders from a serialized DOM; here
  the page is the adopter's own and its JavaScript is the subject, which is the
  one item on this list that is a position rather than a gap. The rest are
  answered ([stabilization.md](stabilization.md)): CSS animations and
  transitions are pinned before the subject is *read* rather than only before it
  is painted, and GIFs are frozen **on the wire** — the response truncated to its
  first frame before the browser decodes it, which needs no canvas and therefore
  no CORS grant, and returns the author's own bytes rather than a re-encode. The
  recipe's digest is in the environment key, which neither Percy nor Argos
  records.
- **Retroactive rules without re-running tests.** On-demand snapshot rules apply
  from the dashboard, auto-save, and persist to future branches
  ([rules](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/snapshot-rules)).
  Fixing a noisy subject here means editing code and waiting for another run.
- **No-code on-ramps.** URL list, sitemap.xml, static directory, or a crawl-based
  Visual Scanner with no code changes. A URL list, a sitemap and a
  static directory are shipped paths here — `route-collector` takes
  addresses, a `sitemap` or a `directory`, plus `widths`, which is the shape a
  `.percy.yml` is written in
  ([replacing §2b](replacing.md#2b-replacing-percy-on-a-set-of-urls)). The
  crawler is Percy's alone, and by choice rather than by omission: a sitemap
  *index* is not followed here either, because fetching what a fetched document
  points at is a different product with a different failure mode
  (`packages/route-collector/src/index.ts`).
- **Unlimited users on every tier including Free.** Visual review is a team
  activity; Percy does not tax the reviewers.

### Chromatic

- **Zero-authoring test discovery.** If stories exist, tests exist. Play
  functions run as interaction tests before capture
  ([docs](https://www.chromatic.com/docs/storybook/test/)). A built Storybook is
  five lines of config here and no collector
  ([§4](#4-what-is-written-and-unrun)), and play
  functions run before the capture on both — Storybook's own preview runs them,
  and its phase order puts `storyRendered` *after* `playing`, which is the event
  this waits on. Measured against a story whose subject only exists after a
  click, rather than assumed in either direction.
- **TurboSnap over a bundler graph.** A change is traced through webpack's own
  dependency graph, which catches a component that is imported and *not yet
  rendered* — a conditional branch nobody has taken. Selection here reads what the
  last run actually painted, and travels from a changed file to a component
  through a graph scanned from the **source** rather than produced by a build
  ([`selecting.md`](selecting.md)): no plugin, no stats file, and nothing that
  goes stale when a bundler is upgraded. It is blind to exactly that case, for a
  reason no graph fixes — a component nothing has ever rendered is in no baseline.
  Both widen to the whole suite when a change cannot be attributed; theirs says so
  in its docs and this says so in its report.
- **Accessibility as a product, not a rule list.** axe on every snapshot, in a
  dashboard, with a triage flow and a history
  ([a11y](https://www.chromatic.com/docs/accessibility-tests/)). This project
  computes the accessibility tree and reports defects in it
  ([§3.5](#35-what-a-comparison-cannot-reach)) with a component and a file
  attached, which axe does not do — but the rule list is nine rules against
  axe's ~90, there is no UI, and nobody has triaged anything.
- **Baseline and branching semantics worked out in production.** Per-branch
  baselines, branch-point inheritance, most-recent-approved-wins on ambiguous
  merges, and explicit squash/rebase detection through git provider APIs when git
  history alone cannot answer
  ([branching](https://www.chromatic.com/docs/branching-and-baselines/)). This
  project has never run a rebase experiment; spec §10's "0 baseline breakage
  across rebase" target is unmeasured.
- **Automigrate Baselines.** Baselines migrated automatically across Chromatic's
  own browser and infrastructure upgrades
  ([SteadySnap](https://www.chromatic.com/features/steadysnap)) — a mass
  false-positive event that most hosted competitors hand to the customer.
- **UI Test / UI Review as separate checks.** Assigned reviewers, persistent
  default reviewers, threaded discussion anchored to individual snapshots, and no
  repo access required for designers ([review](https://www.chromatic.com/docs/review/)).
  Nothing here brings a non-engineer into the loop.
- **Candid documentation.** The TurboSnap page volunteers its own failure modes —
  that a change to anything `preview.js` imports invalidates every story, that a
  merge commit takes the *union* of both ancestors' changes, that a missing
  lockfile forces a full rebuild
  ([TurboSnap](https://www.chromatic.com/docs/turbosnap/)). That is the same
  virtue this document is attempting, shipped, on a page that sells the feature.

### Argos

- **Longitudinal test health, and it is the best in the category.** Per-test
  flakiness scores over selectable windows, diffs grouped into distinct *changes*
  by fingerprint and ranked by recurrence with first- and last-seen, and an
  Ignored register that reports how many builds each ignore has absorbed so an
  ignore that outlived its flake does not stay a blind spot
  ([test page](https://argos-ci.com/docs/learn/reliability-and-flakiness/test-page.md)).
  This project groups a run's diffs into distinct changes — same idea, ranked by
  how much of the review one action finishes rather than by recurrence — but the *longitudinal* half is the whole point of theirs and this
  has an accumulation design and no accumulated data. One run's grouping is not
  a flakiness score.
- **Fingerprint-scoped ignores, in production.** An ignore is a (test,
  diff-shape) pair, not a muted screenshot and not a masked coordinate region, so
  silencing a known flake does not blind the suite to a different regression in
  the same image. The implementation is public
  ([mask-fingerprint](https://github.com/argos-ci/mask-fingerprint)). This
  project has the same idea — [`ignores.md`](ignores.md),
  [ADR-0025](context/adr/0025-an-ignore-names-a-place-or-a-shape.md) — with the
  semantic fingerprint additionally carrying the component responsible, so a
  flake silenced in `Avatar` is not silenced in `Badge`. What Argos still has and
  this does not is the *longitudinal* half above: the register here reports what
  each ignore absorbed in **this** run, and nothing accumulates across runs.
- **A dozen stabilization mechanisms, each its own documented page.** `srcset`
  re-resolution, sticky-to-relative with a rollback if the box moved, spellcheck
  squiggles, subpixel image rounding, background-image preloading, hover reset,
  and font-rendering launch flags
  ([flaky tests](https://argos-ci.com/docs/learn/reliability-and-flakiness/flaky-tests.md)).
  This project ships six tricks plus the wire, and names the rest of the gap in
  [stabilization.md](stabilization.md). Three things go the other way. Argos does
  no animation work of its own — it passes Playwright's `animations: 'disabled'`,
  a *screenshot* option, so a semantic tier would have the same hole this one
  had. Its GIF freezing runs in the page, through a canvas, and its own docs
  concede that a cross-origin image without CORS keeps animating; doing it on the
  wire has no such case. And nothing on either side of their pipeline records
  which stabilizers ran in the identity of the baseline, so retuning one is a
  mass diff attributed to your code.
- **An inspectable diff engine.** Two `odiff` passes at thresholds 0.15 and
  0.0225 with antialiasing on, in a file the vendor links to
  ([source](https://github.com/argos-ci/argos/blob/main/apps/backend/src/screenshot-diff/diff/image/index.ts)).
  A verdict can be reproduced locally.
- **Rendering in customer CI, same as here — but shipped.** Your browsers, your
  fixtures, your auth, your feature flags, and no repo content permission
  required. This is the axis on which the two projects agree architecturally, and
  Argos has it working for paying users.
- **A hard cost ceiling.** Spend management pauses builds at an operator-set
  dollar amount ([docs](https://argos-ci.com/docs/learn/billing-and-subscription/spend-management.md)).
- **Review UX built by people who review**: multiple independent reviewers,
  comments pinned to an exact pixel or line range, a full keyboard path.

### Applitools

- **The pricing unit decouples cost from the browser matrix.** One checkpoint
  across ten browsers and three viewports is one Page
  ([ToS](https://applitools.com/terms-of-use/)). No other vendor here does this,
  and it is the single most important affordability property at scale.
- **The most granular tolerance controls in the category.** Strict, Layout,
  Ignore Colors, Dynamic, Exact and None, applicable per checkpoint or per
  region, plus floating regions and ignore-displacements — and dashboard-created
  ignore regions bind to the underlying DOM element so they survive layout shifts
  ([advanced usage](https://applitools.com/docs/eyes/playwright/advanced-usage)).
  The nearest thing here is `sensitivity`, a narrower idea deliberately: three
  levels, declared per subject with a required
  reason and a register that names a rule absorbing nothing. Applitools has more
  controls and applies them per region; this has fewer and can say, six months
  later, which of them stopped being needed.
- **Triage that scales by grouping.** Steps are clustered by the *shape* of their
  diff regions and one accept propagates across the batch
  ([maintenance](https://applitools.com/docs/eyes/concepts/reviewing-tests/test-maintenance)).
  `variance accept --shape <fingerprint>` does the same thing from a command
  line, and refuses by name any subject where something else also moved. The
  clustering half is there too: a run's changes are grouped into distinct changes
  ranked by how much of the review one action would finish, in
  the PR comment and as `variance_changes` for an agent. Applitools clusters by
  the shape of the diff regions; this clusters by a fingerprint that also carries
  the component responsible, so the same-looking change in `Avatar` and in
  `Badge` are two clusters rather than one. What Applitools still has is the
  dashboard the batch is accepted from.
- **Genuine on-premise deployment.** The Eyes server installed inside the
  customer network with images stored locally
  ([modes](https://help.applitools.com/hc/en-us/articles/360007189231-The-different-deployment-modes)) —
  the only vendor here that offers it, and the answer for buyers who would
  otherwise have to build something like this project.
- **Breadth.** 30+ SDKs across five languages, native mobile, and a review UX
  that a non-employee practitioner
  ([HN 9643765](https://news.ycombinator.com/item?id=9643765)) singles out.

---

## 3. Where this project is genuinely different

Five axes. Each is stated with what has been measured and what has only been
built or argued. Every measured figure names the file that produces it. **`yarn
test` re-derives the verdict counts; it does not re-derive the timings.** Three
README figures come from scripts no test asserts
([§3.3](#33-deciding-at-the-cheapest-representation-that-can-decide)), the
session-cost numbers are printed under deliberately loose bounds, and no timing
reproduces on a second machine by definition.

Two framing caveats apply to everything in this section:

1. **One corpus, written by the same people who wrote the implementation.**
   `examples/kitchen-sink` (8 subjects, 40 declared cases, 20 stable / 20
   changed) and `examples/todomvc` (15 stories, 9 mutations). Ground truth was
   declared before the pipeline existed, which is worth something. Zero
   third-party component libraries have been run through any part of this. The
   corpus has already been caught being convenient once: journal 0008 records
   that it applies token overrides inline on the subject root, which routed
   around a hole where `:root` tokens reached nothing at all under jsdom — the
   token band was inert on the cheap tier and the score did not notice.
2. **One machine.** Every number is one M-series Mac and one Chromium build.
   `docker/linux-verify.sh` exists; `docker/results/` does not.

### 3.1 A diff that names a component and a file

**This is the axis with the widest gap, and the gap is narrower against
Chromatic than against the others.** Percy's Root Cause Analysis stops at a CSS
class or an HTML tag. Applitools' stops at a DOM path and changed CSS properties.
Argos carries the *test spec's* file and line. For a component-level Storybook
story, Chromatic's answer — the story names the component, and the story file
sits next to it — is sufficient and needs no fiber traversal; `chromatic trace`
already walks that module graph. The gap opens on page-level and E2E subjects,
where every competitor's answer collapses to "this page moved", and on the
cause/collateral split, which none of them attempt at all.

The cause/collateral split is easy to get wrong one layer below the claim, so it
is worth naming the trap. A `prop` root — `Panel → Button`, meaning `Panel`
passed something new — can be labelled correctly on the docket entry and then
attributed to `Button` in the per-component roles the report prints, sending a
reviewer into a file nobody edited. `Root.cause` records the responsible
component, and `packages/dom/src/attributed.test.ts` asserts the distinction.

**Measured.** `examples/todomvc/src/observe.chromium.test.ts` (10 tests) takes a
real Chromium screenshot pair through mask → regions → box tree → owner chain →
file:

```
--- broken-toggle on page/todos--populated
what a pixel differ reports:  1530 pixels changed
what this reports:            5 region(s)
  cause       933px in 2 region(s) — Text     src/ds/components.tsx:42
  cause        86px in 2 region(s) — Toggle   src/ds/components.tsx:107
  collateral  511px in 1 region(s) — Stack    src/ds/components.tsx:27
```

The `cause`/`collateral` split is the load-bearing part. Ranked by area the
report is wrong: `Stack` was never edited, only reflowed, and it outranks the
actual edit by roughly 6×. Area measures displacement, so the ordering has to
come from the tier that has provenance (journal 0013).

**Measured against a real incumbent, not against a model of one.**
`cases/incumbent-case` installs `@playwright/test` and runs *its* runner, *its*
`toHaveScreenshot`, in its own process, over the same page and clip we read —
record on the trunk, compare on the branch. Eight edits, declared with their
arguments before either arm ran, scored against *must a reviewer be told?* rather
than *did the image change* (journal 0014):

```
  incumbent (defaults)  3 hit, 3 miss, 1 hold, 1 deferral
  incumbent (tolerant)  2 hit, 4 miss, 1 hold, 1 deferral
  ours                  6 hit, 1 false alarm, 1 deferral
```

Two configurations, because one would be a straw man whichever it was: `defaults`
fails on a single differing pixel, which no real suite survives; `tolerant` sets
`maxDiffPixelRatio: 0.01`. On the two rows both arms detect, the difference is
what is handed over — *5446 pixels (ratio 0.04) are different* against
`Heading src/surface.tsx:153`.

Three qualifications, in the same spirit as the rest of this section. The
comparator is `pixelmatch` at Playwright's defaults — the differ behind most of
the ecosystem, which is why it was chosen, and still one comparator on one
machine. The eight scenarios were chosen by us because we believe they separate
the tools, which is not a representative sample of a suite. And the run corrected
the declared corpus twice, both recorded rather than edited away: `toHaveScreenshot`
*does* measure across a size mismatch in 1.62, where the scenario had been
declared as a refusal to; and attribution named `Indicator` where `Toolbar` was
predicted.

**All three lines resolve to the same file.** `examples/todomvc/src/ds/components.tsx`
is 143 lines and declares all seven components in the example's design system, so
this capture measures the component→*line* hop and does not discriminate the
component→*file* one. The ambiguity path `source.ts` documents — two files
declaring one name — has never occurred in a measurement.

**Every line above is a declaration, which is one hop short.** Reading the
repository resolves the *name* `Toggle`, so the answer is where `Toggle` is
written, and it is the same line for all four `<Toggle>`s on a page. The exact
answer is the location the JSX transform already computed for the element —
absent from React 19's fiber, but only because React 19 discards what the
transform passes it. [`@variance-authority/jsx-source`](../packages/jsx-source)
keeps it, reports prefer it wherever it is present, and it costs nothing stored:
the location rides a symbol-keyed prop, so it enters no digest and moves no
baseline. Measured on `cases/storybook-case` through a **minified production
build**: `Button` is declared on line 51 of `src/ds.jsx`, its `<button>` is
written on 53, and the report says 53 (journal 0020).

It does not ask for `jsxImportSource` to do it. That setting is one per build and
a project using Emotion or theme-ui has already spent it, so the runtime installs
*underneath* React's instead — a bundler plugin for anything Vite builds, a
resolver for Jest — and every custom runtime layered above keeps working
unchanged, because each of them forwards the transform's source argument on its
way down (journal 0021).

**Against a development build it asks for nothing at all.** React's development
build captures an `Error` inside its own element factory and keeps it on every
fiber; the collector resolves the first non-vendor frame in it through the source
map the dev server already emits. No plugin, no `jsxImportSource`, no `jsxDev` —
which matters because every one of those is an edit to the build that ships
production code, made so that a test can see more. Proved end to end against a
Vite dev server whose `vite.config.mjs` is `export default {}` (journal 0022).

Supporting measurements:

| Claim | File | Result |
|---|---|---|
| Owner chains resolve to component display names, without the React DevTools hook | `packages/react/src/provenance.test.ts` (23 tests) | Against React 19.2.8 |
| Portals belong to the subject by component tree, not DOM containment (ADR-0007) | `packages/dom/src/portal.test.tsx` (6 tests) | Container hash is byte-identical whether the dialog is open or closed. The **342 bytes** that move is a one-off corpus measurement from journal 0003, restated as prose at `packages/react/src/portal.ts:12` and asserted by no test |
| Semantic diff separates root from collateral; token attribution | `packages/core/src/compare/diff/diff.test.ts` (29 tests) | — |
| `impact` (`layout`/`paint`/`composite`) as an axis orthogonal to bands | `packages/core/src/compare/diff/impact.test.ts` (18 tests) | `--brand` → `token/paint`; `--space` → `token/layout` (journal 0009) |
| Component → file by reading the repo, with no build change at all | `packages/core/src/attribute/source.ts`, `examples/todomvc/src/source-index.ts` | **A regex scan**, not a source map, and the answer for a repository that has configured nothing. It names where a component is *declared* — the same line for every instance of it. Misses components produced by a factory, assigned dynamically or re-exported under another name, and can name a capitalised non-component; a name declared in two files is reported as ambiguous rather than guessed. Limits stated in `source.ts`. **No dedicated test**; exercised only end-to-end on one example app |
| Element → the line of JSX that wrote it | `packages/jsx-source` (11 tests), `cases/storybook-case/src/cli.chromium.test.js` | No patched React and no fork. `_debugSource` is gone in React 19, but the transform still computes the location and React is what discards it, so a runtime standing where React's used to resolve keeps it. Preferred over the scan wherever present: `Button` is declared on line 51 of the case's `src/ds.jsx` and its `<button>` is written on 53, and the report says **53**, through a minified production build. Costs nothing stored — the location rides a symbol key, so it enters no digest and moved no baseline |
| The same, with nothing whatever in the build | `packages/route-collector/src/zero-config.chromium.test.ts` (24 tests), `packages/core/src/attribute/` (176 tests), `packages/react/src/callsite.test.tsx` (8 tests) | A React application in a temporary directory, served by a real Vite dev server, collected and asserted byte-exact. Four fixtures across two React majors: `vite.config.mjs` holding `export default {}` — classic transform, `createElement` — and one holding the single setting `jsx: 'automatic'`, each on React 19 and React 18. Every passing fixture reports every element's own line: the `<span>` inside `Badge` rather than `Badge`'s declaration, and `<main>` and `<section>` from one render separated by the line between them. React 19 resolves a captured `Error` through the dev server's source map — asked for by the report rather than done on capture, and one of the tests measures that asking about one element costs one call site; React 18 reads `_debugSource`, which the compiler already computed, and pays nothing. **React development builds only**, and the one combination with no answer — React 18 with the classic transform — is asserted as such; a minified production artifact carries neither field, which is what the rows above are for |
| The same, beside a custom JSX runtime | `packages/jsx-source/src/under.test.ts` (5 tests) | Against **Emotion 11.14**, with `jsxImportSource` left pointing at `@emotion/react`. Every element keeps its own line and Emotion still emits its generated class. The one element Emotion rebuilds — anything carrying a `css` prop — records one fiber up, because `createEmotionProps` copies with `for…in` and drops symbols; `resolveProvenance` climbs composite ancestors to find it. Verified through three installers: a production Storybook build, Vitest, and Jest |
| Region clustering from a change mask | `packages/core/src/attribute/region.ts`, `region.test.ts` (12 tests) | Grid `cell = 8` at `packages/core/src/attribute/region.ts:82` |

**Claimed, not measured.**

- **`rankRegions` rests on one mutation and one story** (`broken-toggle` on
  `page/todos--populated`). The finding that area ranks the displaced above the
  displacer is solid; its generality is not measured. With no causes supplied the
  fallback *is* area — journal 0013 calls that "honest, and not good".
- **`cell = 8` was never swept.** It was chosen by argument ("a word should be
  one region").
- **The cross-subject docket has never seen a real change set.** `buildDocket`
  aggregates roots by stable root id and is tested on constructed diffs at
  **3 subjects** (`packages/core/src/judge/docket.test.ts`, 12 tests). "One token, 300
  collateral, one action" is demonstrated at 3, not 300.
- **No Vue, Svelte or Angular application has been run through this.** That is a
  count of implementations rather than a property of the approach, and the two
  are worth keeping apart: "provenance is React-only" would be the stronger claim
  and it is false. `collect()` takes `provenanceOf` as a caller-supplied
  callback, and attribution needs a renderer to supply exactly two things — a
  component name per element and a digest of what was passed in.
  `packages/dom/src/attributed.ts` is the second implementation and reads them
  from two `data-*` attributes in a **25-line** `attributeProvenance`;
  `packages/dom/src/attributed.test.ts` drives the whole chain — diff, docket,
  root versus collateral — from markup with no framework in the process, and
  asserts that the attributes are dropped before hashing so adding a build
  plugin invalidates no stored baseline. Vue's `vite-plugin-vue-inspector`
  already emits an attribute of this shape; Svelte's compiler knows the
  component and the file for every element. What is unmeasured is any real
  application of any of them.

### 3.2 Flakiness treated as a taxonomy of absorption, not a tolerance

The category's answers are retries and thresholds, which trade a false alarm for
a missed regression at a rate that is rarely reported per-suppression. Argos is
the exception and the closest to a different answer: fingerprint-scoped
auto-ignore, plus an Ignored register that reports how many builds each ignore
absorbed — pragmatic, shipped, and working at a scale nothing here has been run
at. Nothing here reports that rate either, because nothing here has cross-run
data at all.

The position taken here is that each cause of variance gets absorbed by
*construction*, by the *environment key*, by a *policy decision*, or by
*nothing*, and that lumping all four under "flaky" is what makes the category
feel unmanageable. The full table, including the rows where this loses, is in
[`docs/flakiness.md`](flakiness.md).

The *policy* row has a mechanism rather than only a name:
[ignores](ignores.md) scope to a subtree or to a difference shape, never to a
coordinate, and every run reports what each rule absorbed and names the rules
that absorbed nothing ([ADR-0025](context/adr/0025-an-ignore-names-a-place-or-a-shape.md),
[ADR-0026](context/adr/0026-ignored-is-not-unchanged.md)). Two things follow that
are worth stating against the competitors: a subject silenced this way reports
`ignored` rather than `unchanged`, so a suite can be asked how much of its green
it earned; and the semantic fingerprint carries the component responsible, so a
flake silenced in one component is not silenced in another that produces an
identical-looking difference. What is still missing next to Argos is the
longitudinal half — the register answers for *this* run, and nothing accumulates
across runs.

**Measured** — `examples/todomvc/src/pixel.chromium.test.ts` (20 tests, 1 skip)
runs both arms over the same instability probes:

| Probe | Pixel arm | Semantic arm |
|---|---|---|
| Text smoothing mode | **177 px** | unmoved (no threshold set) |
| Device pixel ratio | **3015 px** | different environment key — never compared |
| Clock / dynamic text | **73 px** | masked at the text node, which follows content |
| Scrollbar reflow | 0 px | holds — headless has overlay scrollbars, so the classic reflow does not reproduce for either arm |
| Reindented JSX inside a block | 0 px | **moves the hash** — the row this loses |

Separately, and **not** an instability probe: `canvas-repaint` is a real
user-visible change the semantic arm cannot see, and the test asserts that
blindness directly (`renderHeld === true`, in the file's "what it catches that we
do not" block). The magnitude — **857 px at the default allowlist, 2031 px at
strict** — is a `scripts/pixel-arm.mjs` figure from journal 0010, on one machine,
asserted by no test. Journal 0011 records it as still blind and not fixable by
extending the allowlist.

**Measured** — cross-pollution attributed rather than prevented.
`packages/session/src/session.test.ts` (21 tests) and
`packages/session/src/report.test.tsx` (5) keep
one standing world and derive what each subject *read* from its own capture, so
pollution becomes a read-write conflict with a named writer and selector rather
than a rebuild-the-world tax on every subject.
`packages/session/src/cost.test.ts` prints a speedup and a probe share on every
run and asserts only `ratio > 1.5` and `probeShare < 0.15`
(`cost.test.ts:111,121`). Observed on one M-series Mac across runs: **3.1×–3.9×,
probe overhead 1.8%–2.2%** (30 subjects, 302 CSS rules). **Treat the bound, not
the multiple, as the claim** — the repository itself prints three different
figures for this one quantity, and the number moved twice while this document was
being written.

**Measured** — cruft removal. `packages/dom/src/collect.test.ts:80`
asserts that growing an accreted CSS-in-JS sheet from 5 to 500 generations leaves
the render hash **byte-identical**. This is the failure where a baseline decays
simply by being run later in a suite.

**Claimed, not measured.**

- The session speedup is printed as **3.4×** in `docs/flakiness.md` and ADR-0009
  and **3.5×** in the checkpoint. Any document quoting a specific multiple —
  including this one — is quoting one sample of a number that moves.
- **The session benchmark does not measure the thing it stands for.**
  `cost.test.ts` times `new JSDOM()` per subject as a stand-in for a browser
  launch or a Storybook reload, which ADR-0009 asserts is "three orders of
  magnitude worse". That claim is never measured. Whatever multiple prints is the
  cheapest member of the family.
- **Every instability probe simulates its cause** — a smoothing mode instead of a
  GPU driver, a second browser context instead of a second runner — because
  varying the machine is not available from inside a test.
- **Fonts are a caller-supplied string, not a content hash.** A second machine
  can render different geometry and the environment key will not say so. The
  metric probe reports metric-compatible substitutes — exactly what a Linux
  container ships — as *missing*, and the false-alarm rate that produces has
  never been measured.
- **Open blind spots no test closes**: an image swapped behind a stable URL
  (`assets` are caller-supplied content hashes,
  `packages/dom/src/collect.ts:81`); cross-origin stylesheets, which
  fingerprint as `unreadable` and compare **equal**; animations mid-flight, which
  are not paused; headless overlay scrollbars, where the classic reflow does not
  reproduce for either arm. The property allowlist models what an author declares
  about a box and models platform painting poorly — two gaps were closed at
  `ALLOWLIST_VERSION a2`, and journal 0011's call for a systematic audit against
  the CSS property index has not happened. Two found in an afternoon is weak
  evidence there were only two.

### 3.3 Deciding at the cheapest representation that can decide

Both rendering surfaces emit the same snapshot format and enter the same
normalizer. jsdom is not a cheap browser — it is an earlier gate that settles the
token band and structural geometry in the unit-test process. A band a profile
cannot observe reports `unobserved` rather than passing (ADR-0002, ADR-0008).

**Measured.**

| Claim | File | Result |
|---|---|---|
| Corpus scored under `jsdom` against ground truth declared before the pipeline existed | `examples/kitchen-sink/src/measure.test.tsx` (95 tests) | **scorable 38, agreed 38/38, false unchanged 0, false changed 0**; 1 undecidable, 1 contested |
| Same corpus under `chromium` | `examples/kitchen-sink/src/measure.chromium.test.tsx` (103 tests, 1 skip) | **scorable 39, agreed 39/39, false unchanged 0, false changed 0** |
| P4 — the two profiles agree on what both can observe | same file, one run, both halves | **comparable 38, agreement 38/38, undeclared divergence 0** |
| Per-component band hashing: ancestors do not move on a descendant edit and vice-versa | `packages/core/src/attribute/component-hash.ts`, `component-hash.test.ts` (11 tests), corpus acceptance at `measure.chromium.test.tsx:363` | **structure 107/107 agree across profiles; style 0/107.** `structure` is the only cross-tier band; `style` and `geometry` are profile-scoped |
| The raster phases are separable, and separately installable — two need a browser, two need nothing | `packages/raster/src/assemble.test.ts` (6), `packages/png/src/compare.test.ts` (5) | — |
| A jsdom-acquired document renders byte-identically in-process and over an HTTP hop | `packages/remote/src/renderer.test.ts` (7), `examples/todomvc/src/offload.chromium.test.tsx` (5) | — |
| Baseline store partitioned by renderer identity | `packages/store/src/durable.test.ts` (17) | cross-identity → `incomparable`, never `unchanged` |
| Identical verdicts and pixel counts across durable, git-LFS and remote stores | `packages/observe/src/parity.test.ts` (7) | 4 scenarios: `unchanged` / `changed` / `new` / `incomparable` |
| A store that cannot be reached is an operator error, never `new` and never `unchanged` | `packages/remote/src/store.test.ts` (19) | Unreachable endpoint, refused token, hanging lookup, unreadable body; no baseline written |
| Changes that never reach a pixel are decided with **no image consulted on either side** | `cases/incumbent-case/src/replacement.chromium.test.ts` (40 tests) | A dropped `aria-label`, a demoted heading and a devolved `<button>`: `pixels: 0, semanticOnly: true` for all three, against a real `toHaveScreenshot` that is silent on all three at **both** its configurations |

**The strongest form of the cheap-tier argument, and the one worth stating
separately.** The first three scenarios of `cases/incumbent-case` are not missed
by the incumbent because it is tuned wrongly. There is no threshold, comparator
or tolerance that finds a change which never reached a pixel — the evidence is
absent from the representation. That is a property of comparing images rather
than of any product, so it carries to Percy, Chromatic, Argos and Applitools
alike **as an argument from the shape of the thing, not as a measurement**: none
of the four was run, and only `toHaveScreenshot` was.

The fair objection is that a team catches those three with `jest-axe` or a DOM
snapshot, and it is a good objection. The answer is that it is a second tool, a
second suite and a second baseline, not that the first tool should have found
them.

The mirror of that finding, from the same run: `maxDiffPixelRatio: 0.01` of a
420×312 clip is **1310px** of licence, and the status indicator whose removal it
hides is **36px**. A tolerance is a fraction of the *image*; a regression is a
fraction of a *component*. Nothing in the output says which of the two a tolerance
just absorbed. This is arithmetic on one clip size and moves with it.

**Claimed, not measured.** Three of the README's six cost-table rows are not
checked by `yarn test`:

| README claim | Actual source |
|---|---|
| **1007 CSS rules → 1** (99.90% pruned) | Asserted nowhere. `collect.test.ts:96` asserts `kept < 10` on a smaller (~210 rule) fixture. 1007 is a manual reproduction in journal 0005, re-quoted as prose in `packages/core/src/format/document.ts:30` |
| **7.5 ms warm vs 205 ms cold — 27×** | `examples/kitchen-sink/scripts/bench.mjs` only. No test asserts it |
| **65.4 ms screenshot vs 3.4 ms semantic — 19×** | `examples/todomvc/scripts/pixel-arm.mjs` only. Quoted in a doc comment at `examples/todomvc/src/offload.chromium.test.tsx:32`, asserted nowhere |

Also: journal 0007 measures a warm chromium capture at 7.5 ms (kitchen-sink) and
journal 0010 at 4.5 ms (todomvc). Different corpora; journal 0010 explicitly
warns against reading them as one number improving.

And the corpus scores are narrower than 39/39 suggests:

- **The score is a fit.** The first jsdom run scored **30/37** and the first
  chromium run **31/39**; the implementation was repaired nine times in response
  to this corpus (journals 0006, 0007) and one repair was backed out for
  producing a false `unchanged`. All nine were real defects, and ground truth
  having been declared before the pipeline existed is what let the corpus refute
  the implementation at all — that is worth the credit given above. But 38/38 and
  39/39 are agreement *after* fitting, on the only corpus that exists. **No
  held-out set has ever been scored.** A first run against someone else's
  component library is the closest analogue to those two first runs, and it has
  not happened.
- **`false changed 0` is scoped to the corpus, not to the normalizer.** A
  false-changed is demonstrated in this repository: reindenting JSX inside a block
  element renders at 0 px and moves the hash
  ([§3.2](#32-flakiness-treated-as-a-taxonomy-of-absorption-not-a-tolerance)).
  The corpus contains no reindentation case, so the 0 is a false-*miss* rate with
  no false-*alarm* rate beside it. `examples/kitchen-sink/src/measure.test.tsx`
  names the cases that would give it a denominator.
- `dialog-open/dialog` is **contested** and excluded from both denominators — the
  portalled-subject boundary is exactly what ADR-0007 decided, and the one case
  testing it is not scored.
- `wrapper-flex-block/wrappers` is **undecidable** under jsdom and removed by
  name; the 38 is 39 minus one.
- **Band agreement is weaker than verdict agreement.** Under chromium every
  `token` change that alters a component's size reports as `geometry` (4 cases).
  Only `prop-size/button` declares that via a per-profile clause; the other three
  are reported and not scored. The 39/39 is verdict agreement.
- **`yarn test` passes green on a machine with no browser.** The chromium halves
  are `describe.skipIf(!BROWSER_AVAILABLE)` and collapse to named skips, so a
  green suite does not imply the chromium, raster, offload or pixel claims were
  checked.
- **The acquired document is not proven faithful.** The offload proves a
  jsdom-acquired document paints *something* with the subject's geometry that
  responds to its styling, byte-identically in-process and over a socket. It does
  not prove the image matches the page it was acquired from.
- **The head-to-head's "invisible to a pixel differ" arm is mostly a proxy.**
  `examples/todomvc/src/compare.test.tsx` and `changeset.test.tsx` use
  `appearanceHash`, a jsdom proxy that models what an author *declares* rather
  than what an engine *paints*. The file states this limit itself
  (`compare.test.tsx:35–51`) and it already got `broken-toggle` wrong — reporting
  invisible where real Chromium measured **5482 px across 6 of 15 stories** plus
  a 22px→18px reflow. That refutation is the important part and it holds; the
  number itself is a `scripts/pixel-arm.mjs` output from journal 0010, quoted in
  doc comments and asserted by no test. Only `pixel.chromium.test.ts` uses real
  pixels. The one case needing no argument is `label-detached` (attribute-only,
  **0 px on 15 stories**).
- **The cheap tier is less cheap than the design assumed.** ADR-0002's tier table
  assumed a chromium capture at ~100 ms; measured warm it is 7.5 ms, so the gap
  between the two semantic tiers is **~5×, not ~100×**. "Skip chromium on a jsdom
  hit" therefore buys much less than the architecture was drawn around, and
  whether the two-tier split earns its complexity is open — it is the checkpoint's
  own entry under "Profile skip order", and it bears directly on this
  subsection's thesis.

### 3.4 Accumulation as text, not pixels

The README's headline story: a button gains 2px, eleven times, each approved
correctly, and nobody ever sees the 22px. No threshold catches that, because the
quantity that would have is a **sum**, and nothing in a one-run-at-a-time tool is
summing. Percy accumulates approval state; Chromatic accumulates baselines;
Argos accumulates test *stability*. None of them accumulate the resolved value of
a design token across approvals, because none of them capture it — they compare
images, and the token value is not in the image. (Not for want of a key: Chromatic
keys everything to a stable story id and Argos to a test fingerprint, either of
which could hold a token value. The missing piece is the capture, not the key.)

Whether the *sum* of individually-correct approvals is a defect a team actually
suffers is an argument, not a finding. The run that would settle it — eleven
`run` / `accept --all` cycles raising one token by 2px, ending in a `DRIFT:` line
reporting 22px of travel — is written as a todo in
`cases/storybook-case/src/cli.chromium.test.js`, against the case that would host
it.

**Built and unit-tested.** `packages/history/` (1,719 lines of implementation plus
905 of test): a `HistoryStore`
interface, drift arithmetic as pure functions, an HTTP client, and
`createAbsentStore`. `drift.test.ts` (29), `client.test.ts` (10),
`observation.test.ts` (10), `absent.test.ts` (5). Quiet runs go in the
denominator; only approved changes are summed; collateral accumulates nothing;
caps are always reported; and a no-store answer is a **separate union arm**
(`Unkept`), not an empty result — an agent told "no drift" would conclude the
product is stable, when what happened is that nobody was keeping a record.

`packages/server/`: SQLite via `node:sqlite` behind a `HistoryBackend`, a real
HTTP surface, bearer token. `backend-sqlite.test.ts` (17), `http.test.ts` (18),
`packages/server/src/bin.test.ts` (6) — including append-only enforced at the database level, schema
version refusal, and two branches recording different hashes for one key both
persisting with no merge.

**Not measured, and this is the largest gap in the project.** See
[§4](#4-what-is-written-and-unrun).

### 3.6 A second engine costs a second paint, not a second run

**Measured** in `packages/playwright/src/engines.chromium.test.ts`, against a
real WebKit build.

The category prices coverage by multiplication, and both leaders say so in their
own words: Percy's pricing FAQ works "two pages rendered across two browsers and
three widths" out to twelve screenshots, and Chromatic bills
`tests × builds × browsers × modes`. That arithmetic is not a pricing choice
bolted onto a neutral architecture — it *describes* the architecture. Where a
browser produces the whole observation, observing in a second browser means
running everything a second time, and the bill is honest about that.

Here the observation is a `RenderDocument`, and it is engine-independent: the
markup, the CSS proven to apply to it, the ancestor frame, the inherited floor,
the viewport. It is collected once. Rasterization is the only phase that is
engine-bound, so a second engine re-runs the ~65 ms paint and nothing else — not
the mount, not the pruning, not the collection, not the semantic tiers that
settle most subjects before an image is considered.

**And cross-engine safety required no cross-engine code.** `RenderIdentity`
already carried the engine, because it existed to keep two laptops apart; the
store already files a baseline under `identityDigest`. So a WebKit baseline lands
in its own directory, a Chromium run that finds it reports `incomparable` and
names both engines, and `unchanged` is never available across the pair — by
machinery nobody wrote for this. The test asserts exactly that: the two
identities differ, so the two baselines cannot collide.

**The measurement that justifies the refusal**, over all three engines, one
wrapped paragraph:

| pair | dimensions | differing pixels |
|---|---|---|
| chromium vs firefox | 352×77 both | **827** |
| chromium vs webkit | 352×77 both | **630** |
| firefox vs webkit | 352×77 both | **1288** |

That is evidence that a baseline is genuinely engine-bound rather than assumed
to be, which is what a cross-engine refusal has to rest on to be more than
ceremony.

**And the row that is worth more than the counts: the dimensions are identical in
all three.** Three engines agreed on the box to the pixel and disagreed only on
what they painted inside it. That is the tier ladder's premise arriving as a
measurement rather than as an argument — the geometry the semantic tiers reason
about is portable across engines, and the machine-bound artifact really is
confined to the rung that has one. It is one paragraph on one machine and not a
proof; it is also exactly the shape the architecture predicted, measured for the
first time.

**What is not claimed, and it is most of it.** Every trick in the stabilization
recipe was written against Chromium's behaviour and none has been asked to hold
Firefox or WebKit still. There is no Edge, no mobile emulation, no real device,
and no cross-engine run over the corpus — one document, one machine, once. A
buyer who needs a matrix they can *try* still has four better answers. What the
measurement buys is narrower: the matrix is not structurally absent, and
`variance run` reaches it through a config field rather than only a library call.

### 3.5 What a comparison cannot reach

Everything above answers *what changed*, which needs two of something. Two
questions a product actually has are not of that shape, and every tool in the
category is structurally unable to answer either, because the artifact it kept is
an image.

**A defect present on the first run is invisible to a comparison forever.** A
button that never had an accessible name compares equal to itself on every run
there will ever be, and approving the first baseline approves the defect along
with it. This is not a tuning problem in any product; it is what comparing two of
something means.

**Measured** — `packages/core/src/judge/inspect.test.ts` (26 tests) reads one
normalized snapshot. Nine rules a document can decide without guessing: a control
with no accessible name, an image with neither a name nor an explicit `alt=""`, a
heading level skipped, a control nested inside a control, an id reference that
resolves to nothing, a name that does not contain its visible label, two
landmarks nothing tells apart, a table with no headers, a positive `tabindex`.
Each names a component and a file through the same provenance chain a delta uses,
and each bands `a11y`, so `blocking: ['a11y']` covers inspection and comparison
under one policy. **Every rule has a case where it must not fire**, and for
`label-mismatch` that case — an icon button, whose glyph is `aria-hidden` and is
not a label — is what decides whether the rule is usable at all.

`cases/incumbent-case` asserts both halves of what this reaches. Three of its
eight scenarios are accessibility regressions no configuration of
`toHaveScreenshot` detects; inspection reaches **one** of the three from the
broken render alone. A `<div>` with no role is not a defect in any render taken
on its own — it becomes one only against the `<button>` it replaced. Inspection
and comparison catch different things and neither contains the other.

**Deliberately not an axe-core reimplementation**, and
[ADR-0015](context/adr/0015-a-rule-is-what-a-stored-snapshot-can-decide.md) fixes
the boundary rather than leaving it to drift: a rule belongs here if a stored
snapshot can decide it. Contrast does
not qualify and the file says why — the background a glyph is painted on is a
stacking question a layout engine answers and a document does not, so a
four-line check would be right most of the time, which for accessibility is worse
than no rule. Axe runs against a live DOM
with computed visibility, contrast and focus order, and has roughly ninety rules
to these nine. Chromatic ships axe with a dashboard and a triage flow, and that
is the better product for a team whose requirement is accessibility checking.
What these nine do that axe does not: name the component and the file, and decide
**offline, from a stored artifact, months later**.

**A message catalogue and a PNG have no key in common.** There is no relation
between the string `checkout.cta` and a region of an image, so the category's
answer to a localized UI is N times as many screenshots and a person to look at
all of them.

**Measured** — `packages/core/src/judge/locale.test.ts` (10 tests) and
`cases/incumbent-case/src/locale.chromium.test.ts` (4 tests, real Chromium
layout), one panel in English and German:

```
  translated strings   16
  identical strings    2
  widest growth        2.02× at RowAction
  overflows at 420px   0
  overflows at 300px   2
```

Two findings, both facts rather than ratios: a string identical in both languages
in a subject where other strings moved, and a box that fitted its container in one
language and does not in the other. **No expansion threshold** — "German is 35%
longer" is a rule of thumb, and a build that fails on a ratio is a build whose
ratio gets raised until it stops failing. The growth is measured and reported.

Two predictions in that measurement were wrong and the corrections are the useful
part. The first run found *nothing*, because the rule read text nodes and the only
untranslated string was a `title`; in a real product the forgotten strings are
precisely the ones that are not text nodes — an `aria-label`, a `placeholder`, an
`alt` — which render no pixel of their own. And at 420px German fits: whether a
translation fits is a property of the translation *and* its container, which is
why a ratio cannot answer it and two rectangles can.

**Claimed, not measured.** No localized application has been run through this.
The incumbent was not run at two locales either — that their model needs a
baseline per locale per subject follows from how `toHaveScreenshot` is keyed, and
is an argument from the shape of the thing, not a measurement.

---

## 4. What is written and unrun

Everything here is unit-tested, and that is the weakest of the three claims this
section separates. One tier — **normalize, collect, provenance, diff and band** —
is additionally scored against ground truth declared before the pipeline existed
([§3.1](#31-a-diff-that-names-a-component-and-a-file),
[§3.3](#33-deciding-at-the-cheapest-representation-that-can-decide)). And one
path has executed against a surface this project did not build: `variance run`,
over a production Storybook.

That last one is the line a buyer is asking about, so it is worth being exact
about where it falls. `cases/storybook-case/src/cli.chromium.test.js` spawns the
built binary against a `storybook-static/` and asserts the whole cycle — **12 new
(exit 1) → 12 accepted (0) → 12 unchanged (0) → 5 changed (exit 1)** — where the
changed build carries one edited component, and the run finds exactly the five
stories that render it, at `cases/storybook-case/src/ds.jsx:51`. What is foreign
there is Storybook: its index format, its preview and channel, its minifier. The
components inside it are this repository's, which is what
[spec 0022](specs/0022-evidence-from-code-this-project-did-not-write.md) still
asks for and [the table above](#the-asymmetry-stated-first) states as the
asymmetry.

Everything on that path has met a real subject: the config, the collector seam,
the Storybook adapter, the renderer, normalization, provenance, the docket, the
durable store and the exit codes. Everything off it — the history service, MCP
over stdio, git-LFS as a filter rather than as a `.gitattributes` line, the
GitHub Action, a second platform — is written, unit-tested against fakes and
fixtures, and has not.

**Each gap is written at the line that owns it**, not listed here. A ledger in
prose rots in one direction: its optimistic half is corrected the moment somebody
trips over it, and its pessimistic half survives the work landing, because
nothing fails when a negative stops being true. So a claim that would hold if
something ran is an `it.todo` whose title is the sentence that becomes true and
what it would take; a limb that is not written is a `// TODO:`; a defect in code
that ships is a `// FIXME:`.

```bash
yarn unrun
```

prints all of them with `file:line`, grouped by package, generated from the
source — so it cannot disagree with the code, and closing a gap deletes the claim
rather than leaving it to be noticed. `yarn test` counts the todos in its own
summary line.

The four specs behind the largest of those gaps —
[0002](specs/0002-history-store.md) for accumulated history,
[0016](specs/0016-ci-that-has-run.md) for CI,
[0018](specs/0018-git-lfs-proven-as-git-lfs.md) for git-LFS and
[0022](specs/0022-evidence-from-code-this-project-did-not-write.md) for a
third-party library — say what each is for.
[§5](#5-when-not-to-choose-this) says which of them a given buyer should care
about, and which product to buy instead.

---

## 5. When not to choose this

The differences in [§3](#3-where-this-project-is-genuinely-different) only matter
under specific conditions. Where those conditions do not hold, one of the four
products above is the better answer, and in most cases it is not close.

**Do not choose this if any of the following is true.**

| Condition | Why it disqualifies | Go to |
|---|---|---|
| **Something is needed this quarter** | One path has executed against a subject nobody here authored — `variance run` over a built Storybook. CI, the history service and MCP are written, unit-tested and unrun ([§4](#4-what-is-written-and-unrun)). Adopting this means finishing them | Any of the four |
| **The frontend is not React, and nobody will add a build plugin** | Provenance needs a name per element. React gets it from fiber traversal; anything else gets it from two `data-*` attributes, which is a build-step change somebody has to make and own. Without either, diffs resolve to a DOM path — what every competitor already gives, with support. On React the traversal reads unversioned internals verified only against **19.2.8**; ADR-0005 names three internal contracts, and the third fails *silently*, returning props digests one render stale. A React upgrade is a re-verification event, not a version bump | Argos, Chromatic |
| **Cross-browser or cross-device coverage is the requirement** | Chromium, Firefox and WebKit all run, from a `browser` config field, measured pairwise in `packages/playwright/src/engines.chromium.test.ts`. But: no Edge, no mobile, no real devices, no cross-engine run over the corpus, and no stabilization trick verified outside Chromium. One document is not a matrix | Applitools (one Page covers the matrix), Percy, Chromatic |
| **Non-engineers must review** | There is a JSON report and seven MCP tools. No dashboard, no approval UI, no threaded discussion, no invite flow | Chromatic (UI Review), Percy, Applitools |
| **Cost predictability matters more than cost structure** | There is no unit and no bill, but also no ceiling on the engineering time to operate a spike. A published $0.004/screenshot with a spend cap is a more predictable number than "your own infrastructure" | Argos |
| **Longitudinal flake data is needed now, with a UI on it** | Recurrence over a window ships here, keyed on the component and band that moved rather than on a diff shape, and it needs a service you deploy. What Argos has and this does not is the surface: a per-test page, a browsable ignore register, and auto-ignore at a threshold — plus the operational history of running it at scale ([§4](#4-what-is-written-and-unrun)) | Argos |
| **Storybook is the test surface and coverage should be automatic** | Coverage *is* automatic: the collector is shipped and the operator writes five lines ([§4](#4-what-is-written-and-unrun)). What Chromatic still has and this does not is everything after the verdict — a review UI, assigned reviewers, threaded discussion on a snapshot, and the fact that they maintain Storybook itself | Chromatic |
| **The content under test is canvas, WebGL, video, or heavy third-party iframes** | The bitmap lives in a rendering context, not the document. This is structural, not a missing feature | A pixel differ — any of them |
| **Regulated data with a contractual residency requirement, plus a vendor to sign it** | Self-hosting solves the residency problem and creates a supplier-risk problem: the supplier is a spike with no support commitment | Applitools (real on-premise), or Percy Enterprise GRR |
| **A team that will not maintain its own tooling** | Every property in [§3](#3-where-this-project-is-genuinely-different) is bought with operator effort that the SaaS products absorb | Any of the four |

**The conditions under which the differences do matter**, stated as narrowly as
the evidence supports:

- A React codebase where the recurring cost is not *detecting* changes but
  *triaging* them — where the question after a red build is consistently "which
  component did this" and the answer is a bisect.
- An environment where application markup cannot leave the network, and where
  Applitools' on-premise Eyes is either too expensive or too much product.
- A team that would rather read the diff engine than trust a score, and has the
  appetite to finish the parts marked unrun in [§4](#4-what-is-written-and-unrun).
- An agent-driven workflow where the consumer of the report is a program, and
  `Text src/ds/components.tsx:42` is actionable in a way that a red rectangle is
  not. This is the strongest case for the design and the weakest case
  evidentially: the MCP surface has never served an agent.

**There is no evaluation path.** A reader who agrees with every condition above
still has nowhere to go: the packages are MIT and publishable, but no tag has
ever been pushed, so nothing has reached a registry and there is no version of
this to install ([spec 0015](specs/0015-the-first-published-release.md)).
Outside the three shipped surfaces — a built or served Storybook, a map of
served URLs, a Playwright suite — the collector that mounts
an adopter's own components is theirs to write
([§4](#4-what-is-written-and-unrun)). Nobody can
trial this against their own codebase.

The realistic first move is to read `packages/core/src/compare/diff/` and
`packages/core/src/attribute/source.ts` and decide whether the approach is worth
finishing — because finishing it is what adoption would mean. For what an adopter
would have to write and install, [`surface.md`](surface.md) is the honest
inventory.

A comparison that only finds in its own favour is an advertisement. On maturity,
ecosystem, hosted convenience, browser coverage, review workflow and support, all
four competitors win, and the gap is not small.

---

**Vendor sources.**
[Percy pricing](https://www.browserstack.com/pricing?product=percy) ·
[Percy RCA](https://www.browserstack.com/docs/percy/root-cause-analysis/overview) ·
[Percy SDK workflow](https://www.browserstack.com/docs/percy/integrate/percy-sdk-workflow) ·
[Chromatic pricing](https://www.chromatic.com/pricing/) ·
[Chromatic billing](https://www.chromatic.com/docs/billing/) ·
[Chromatic branching](https://www.chromatic.com/docs/branching-and-baselines/) ·
[Argos pricing](https://argos-ci.com/pricing) ·
[Argos flaky detection](https://argos-ci.com/docs/learn/reliability-and-flakiness/flaky-test-detection.md) ·
[Argos overview](https://argos-ci.com/docs/overview.md) ·
[Applitools pricing](https://applitools.com/pricing/) ·
[Applitools ToS](https://applitools.com/terms-of-use/) ·
[Applitools match levels](https://applitools.com/docs/eyes/concepts/best-practices/match-levels)

**Repository sources.** `checkpoint.md` predates the CLI, history and CI commits
and describes them as excluded from M0; read it as a cycle-5 record, not as
current state. Its first-run corpus scores and its "Profile skip order" entry,
both cited above, are still accurate.

[`docs/flakiness.md`](flakiness.md) ·
[`docs/context/checkpoint.md`](context/checkpoint.md) ·
[`docs/specs/`](specs/README.md) ·
[ADR-0002](context/adr/0002-observation-profiles.md) ·
[ADR-0003](context/adr/0003-cruft-removal-and-css-applicability.md) ·
[ADR-0007](context/adr/0007-subject-boundary-is-the-component-tree.md) ·
[ADR-0009](context/adr/0009-sessions-detect-instead-of-rinse.md) ·
[ADR-0011](context/adr/0011-durable-and-ephemeral-retention.md) ·
journal [0005](context/journal/0005-collector-and-css-pruning.md),
[0007](context/journal/0007-persistent-harness-and-p4.md),
[0008](context/journal/0008-sessions.md),
[0010](context/journal/0010-pixel-arm.md),
[0011](context/journal/0011-refuted-and-corrected.md),
[0012](context/journal/0012-instability.md),
[0013](context/journal/0013-observability.md)
