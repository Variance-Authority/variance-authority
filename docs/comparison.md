# Comparison

For engineers deciding whether the attribution approach in
[§3.1](#31-a-diff-that-names-a-component-and-a-file) is worth tracking. It is not
a pitch to adopt anything: [§5](#5-when-not-to-choose-this) names which product to
buy instead, and for most readers the answer is one of the four.

**Written 2026-08-02.** Vendor pricing and features move; every figure below was
read from the vendor's own pages on that date and carries a link. Re-verify
before relying on any of it. A claim that a competitor *lacks* something reads
"not documented as of 2026-08-02" and cites the page searched — absence from
documentation is not absence from a product, and a feature may live at the
test-runner layer rather than the vendor's. Every number attributed to this
project carries the file that produces it, is marked **measured** or **claimed**
accordingly, and was re-checked against the working tree on 2026-08-02.

## The asymmetry, stated first

Percy, Chromatic, Argos and Applitools are products. They have customers, uptime
commitments, support contracts, browser fleets, and years of production contact
with codebases nobody on their team wrote. Variance Authority is an M0 spike. It
has never been run against a repository that is not its own.

The specific consequences, so they are not left to be inferred:

| They have | This has |
|---|---|
| Chrome, Firefox, Safari, Edge, mobile emulators or real devices | One Chromium build, `deviceScaleFactor: 1`, one font stack, `color-scheme: light` pinned |
| A hosted dashboard designers and PMs use without repo access | A JSON report and five MCP tools |
| Years of contact with third-party component libraries | One corpus, written by the same people who wrote the implementation |
| Support, SLAs, and someone to call | A git repository |
| MIT (Argos), or a commercial contract legal can sign | No licence chosen yet. The project is scaffolding — nothing is published and no distribution has been decided, so there is nothing to license *to* anyone. A reader evaluating it for adoption should read the rest as a description of an approach rather than of something obtainable |
| A working install path: `npx`, a token, a green check on a PR | A CLI executed end to end against one Storybook this project did not write, and against nothing else ([§4.2](#42-nothing-above-the-cli-boundary-has-been-run)) |
| Linux CI, verified by every customer who runs it | Every measurement in this repository from one M-series Mac |

Anything below that reads as an advantage should be read against this table. The
axes where this project is different are narrow, and most of the category's
surface area is not one of them.

---

## 1. The dimensions a buyer actually decides on

| | **Percy** (BrowserStack) | **Chromatic** | **Argos** | **Applitools** | **Variance Authority** |
|---|---|---|---|---|---|
| **Integration surface** | 20+ SDKs: Selenium, Playwright, Cypress, Puppeteer, Storybook, Appium; plus no-code URL list, sitemap, static dir, crawler ([SDKs](https://www.browserstack.com/docs/percy/overview/supported-sdks)) | Storybook first-class (stories become tests with no authoring), plus Playwright, Cypress, Vitest ([docs](https://www.chromatic.com/docs/storybook/)) | Playwright, Vitest, Storybook, Cypress, WebdriverIO, Puppeteer, plus a CLI that takes any PNG ([docs](https://argos-ci.com/docs/overview.md)) | 30+ SDKs across five languages, native mobile, Tosca, Katalon ([docs](https://applitools.com/docs/eyes)) | **Not comparable to the four cells on the left, and the row is easy to misread.** Theirs consume an existing suite's output — you keep your Playwright or Cypress tests and add an SDK call. Here every subject is re-mounted by a collector the operator writes, so an existing suite cannot be *pointed at* this at all. What is built: a library callable inside Vitest/Jest via jsdom, a Playwright harness this project owns and drives, and Storybook end to end via `cases/storybook-case`. `subjects.kind: "list"` accepts any subject source and has no worked example. Provenance from React fibers, or from **two `data-*` attributes any build step can emit** ([§3.1](#31-a-diff-that-names-a-component-and-a-file), [surface.md](surface.md)) |
| **Where rendering happens** | Vendor. DOM serialized in your browser, re-rendered server-side across browsers/widths, **JS disabled by default** ([workflow](https://www.browserstack.com/docs/percy/integrate/percy-sdk-workflow)) | Vendor "Capture Cloud". Storybook bundle or E2E archive uploaded and re-rendered ([docs](https://www.chromatic.com/docs/snapshots/)) | **Customer CI.** Argos never launches a browser; it receives PNGs and diffs them ([docs](https://argos-ci.com/docs/overview.md)) | Vendor. Ultrafast Grid re-renders a DOM snapshot in containers; mobile is emulated/simulated ([UFG](https://applitools.com/docs/eyes/concepts/test-execution/ultrafast-grid)) | **Customer, everywhere.** jsdom in the unit-test process, or one Chromium the run owns. Optional remote renderer the operator runs |
| **Cost model** | **Per screenshot** = page × browser × width. Free 5,000/mo; Desktop $199/mo annual → 10,000, overage **$0.036** ([pricing](https://www.browserstack.com/pricing?product=percy)) | **Per billed snapshot** = tests × builds × browsers × modes; TurboSnap = 0.2. Free 5,000/mo; Starter $179/mo → 35,000, overage **$0.008** ([billing](https://www.chromatic.com/docs/billing/)) | **Per screenshot.** Free 5,000/mo; Pro from $100/mo → 35,000, overage **$0.004** ($0.0015 Storybook). SSO priced separately ([pricing](https://argos-ci.com/pricing)) | **Per Page** = a unique checkpoint *regardless of browser, device or version*. No public price at any tier ([pricing](https://applitools.com/pricing/), [ToS](https://applitools.com/terms-of-use/)) | No unit. Compute is the operator's; storage is a directory, git-LFS (**never exercised as git-LFS**, [§4.2](#42-nothing-above-the-cli-boundary-has-been-run)) or a remote endpoint the operator runs. Sized below — estimated, never operated |
| **Flakiness handling** | Determinism up front — JS off, GIFs frozen, CSS animations frozen ([animations](https://www.browserstack.com/docs/percy/stabilize-screenshots/animations)) — plus manual suppression. No per-snapshot flake rate, quarantine or retry documented as of 2026-08-02; retries may exist at the test-runner layer instead | SteadySnap: render stabilization, Burst Capture (multiple renders, pick most stable), freeze frame, **auto-migrated baselines across their own browser upgrades** ([SteadySnap](https://www.chromatic.com/features/steadysnap)) | **Diff fingerprints.** An ignore is a (test, diff-shape) pair; auto-ignore after N occurrences in 7 days; flakiness score 0–100 per test; an Ignored register with occurrence counts ([docs](https://argos-ci.com/docs/learn/reliability-and-flakiness/flaky-test-detection.md)) | Perceptual matching, six match levels, floating/ignore/layout regions, DOM-anchored ignore regions, `MatchTimeout` 2s retry. No cross-run flake score documented as of 2026-08-02 ([match levels](https://applitools.com/docs/eyes/concepts/best-practices/match-levels)) | **No flake rate, no quarantine, no retry, and no cross-run data at all** ([§4.1](#41-nothing-has-ever-recorded-a-history-row)) — strictly less mitigation than the two cells to the left. What exists instead is a classification of causes by what absorbs them: construction, environment key, policy, or **nothing** — and [flakiness.md](flakiness.md) lists five causes currently absorbed by nothing, including mid-flight animations and cross-origin stylesheets. Cross-pollution is attributed to a named writer rather than suppressed. That is a position, not a mitigation |
| **Attribution: does a diff name a component and a file?** | **No.** Root Cause Analysis names the changed element's CSS class, or its tag if it has none. No component, no file, no commit ([RCA](https://www.browserstack.com/docs/percy/root-cause-analysis/overview)) | **Component yes, by construction; file no.** A snapshot *is* a story, so the story title names the component. For a page-level story the answer is "this page moved". `npx chromatic trace` walks the module graph file→story offline — the same category of offline repo lookup this project's own last hop uses, pointed the other way ([trace](https://www.chromatic.com/docs/turbosnap/trace-utility/)) | **No.** Metadata carries the *test spec's* file and line (`tests/home.spec.ts:42:3`) and the Storybook story id. No component field and no map from a diff to product code in the documented metadata ([metadata](https://argos-ci.com/docs/reference/screenshot-metadata.md)) | **No.** RCA names DOM elements and changed CSS properties with a DOM path. GitHub status Details links go to the Test Manager, not to source ([RCA](https://applitools.com/docs/eyes/concepts/reviewing-tests/root-cause-analysis)) | **Yes, measured on one corpus**: pixels → regions → components → `file:line`, ranked from the semantic tier. Two provenance adapters — React fibers, and 25 lines reading `data-component`/`data-props`, which is what a Vue or Svelte build step already emits. The `cause`/`collateral` ranking rests on one mutation, one story, one self-authored example app, one machine ([§3.1](#31-a-diff-that-names-a-component-and-a-file)) |
| **Review and approval** | Dashboard approval persisting across a branch's lifespan, snapshot rules that persist to future branches, **unlimited users on every tier including Free** ([approval](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/approval)) | UI Test and UI Review as separate checks, assigned and persistent default reviewers, threaded discussion anchored to an individual snapshot, no repo access required for designers ([review](https://www.chromatic.com/docs/review/)) | Multiple independent reviewers, comments pinned to an exact pixel or line range, a full keyboard path, per-test discussion threads ([test page](https://argos-ci.com/docs/learn/reliability-and-flakiness/test-page.md)) | Triage grouped by the *shape* of the diff, one accept propagating across the batch ([maintenance](https://applitools.com/docs/eyes/concepts/reviewing-tests/test-maintenance)) | **The axis this loses hardest, and the one these products are bought for.** `variance accept` writes a sidecar beside an image and explicitly refuses to record history ([§4.1](#41-nothing-has-ever-recorded-a-history-row)). No UI, no reviewer model, no discussion, no merge semantics for two branches accepting differently — and it has never been run |
| **Accumulated history** | Approval persists across a branch's lifespan; snapshot rules persist; 30-day (Free) / 12-month (paid) build history. **No longitudinal per-snapshot metric** ([approval](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/approval)) | Per-branch baselines with branch-point inheritance, squash/rebase detection via git provider APIs, browsable baseline revision history. Retention unpublished below Enterprise ([branching](https://www.chromatic.com/docs/branching-and-baselines/)) | **The strongest in the category.** Per-test flakiness over 24h–90d windows, changes grouped by fingerprint and ranked by recurrence, first/last seen, per-test discussion threads, account analytics with CSV ([test page](https://argos-ci.com/docs/learn/reliability-and-flakiness/test-page.md)) | Baselines keyed by app × test × OS × browser × viewport, with revision history, branch baselines and a merge UI; Insights charts. 1-year retention stated on Public Cloud only ([baselines](https://applitools.com/docs/eyes/getting-started/applitools-workflow/baselines)) | Designed and coded: per-component band hashes + resolved token values, append-only, no pixels. **Nothing has ever written a row** — see [§4.1](#41-nothing-has-ever-recorded-a-history-row) |
| **Self-hosting** | **None, and the architecture forecloses it** — the SDK's function is to ship your DOM to Percy's API. "Automate Self-Hosted" is a different product | **None.** "On-premises" in their docs means self-hosted *git providers* ([FAQ](https://www.chromatic.com/docs/faq/chromatic-sso-on-premises-other-git/)) | MIT-licensed in full, **and the vendor states self-hosting "is not officially supported or documented"** — needs Postgres, RabbitMQ, Redis, S3, DynamoDB, a GitHub App and Stripe ([docs](https://argos-ci.com/docs/overview.md)) | **Yes** — on-premise Eyes server, images stored locally; also private dedicated cloud ([modes](https://help.applitools.com/hc/en-us/articles/360007189231-The-different-deployment-modes), ~7 years old). Scoped to Eyes, not Autonomous | Nothing hosted exists, so nothing has to be opted out of: no telemetry, no phone-home, one outbound call to a renderer endpoint the operator supplies. That is not the same as a self-hosting *story* — **no license** (see the table above), no install path, no upgrade path, no backup story, and the history service is one SQLite file behind a bearer token with no concurrency test ([§4.5](#45-targets-never-measured-and-limits-never-tested)) |
| **Data residency** | Geo Region Restriction, **Enterprise plan only, via an Account Executive**; metadata such as test names stays in the default region regardless ([GRR](https://www.browserstack.com/docs/enterprise/security/geo-region-restriction)) | **Undocumented publicly.** No stated provider, region, or EU option; SOC 2 Type 2 and 99.9% SLA are stated ([security](https://www.chromatic.com/security)) | **US only.** S3 in the US under Standard Contractual Clauses; no documented EU option. SOC 2 Type II ([security](https://argos-ci.com/security)) | Customer-selectable data-centre location including EU on Azure or customer premises; ISO 27001. GDPR page last updated May 2021 ([GDPR](https://applitools.com/legal/gdpr/)) | The operator's network, and the operator's compliance work. Nothing leaves that network, but that is the operator's claim about their own infrastructure, not an attestation: no SOC 2, no ISO 27001, no DPA, no retention policy, no deletion path, no pen test, no auditor has ever read this code. Residency becomes a question about the operator rather than an answer ([§5](#5-when-not-to-choose-this)) |
| **Maturity** | Mature, broad, backed by BrowserStack | Mature; built by the Storybook maintainers | Mature enough to run production suites; small team, key-person concentration | Mature, enterprise sales motion, some docs 7–8 years old | **M0 spike.** 84 test files, 2170 passing / 60 skipped (read 2026-08-03; the row said 76 and 1729 and had gone stale, and the skip count is the number that moved most — the browser-gated halves collapse to named skips on a machine with no Chromium). Zero external users. Nothing published, nothing licensed. A test count is a poor maturity metric here and [§4](#4-what-is-written-and-unrun) says why |

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
any runner price. **The compute is not the bill.** Durable baseline storage has
never been measured in bytes by anything in this repository. The bill is the
engineering time to finish the unrun work in [§4](#4-what-is-written-and-unrun)
and then operate it, and this document will not put a range on that, because
nobody has done any of it and every number would be invented. That is the
comparison: a known $283/mo against an unknown engineering commitment.

---

## 2. What each competitor does better than this project

### Percy

- **Cross-browser rendering from one capture.** Serialize the DOM once in one
  browser, get Chrome, Firefox, Safari and Edge renderings server-side, off the
  CI critical path. This project has one Chromium and no cross-browser arm at all
  — which is a large fraction of what real VR spend buys.
- **Deterministic-by-default rendering.** JS disabled on re-render, animated GIFs
  frozen on the first frame, most CSS animations and transitions frozen
  automatically ([animations](https://www.browserstack.com/docs/percy/stabilize-screenshots/animations)).
  This project does not pause animations; a transform caught in flight reaches
  the representation and is listed as absorbed by *nothing*
  ([flakiness.md](flakiness.md)).
- **Retroactive rules without re-running tests.** On-demand snapshot rules apply
  from the dashboard, auto-save, and persist to future branches
  ([rules](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/snapshot-rules)).
  Fixing a noisy subject here means editing code and waiting for another run.
- **No-code on-ramps.** URL list, sitemap.xml, static directory, or a crawl-based
  Visual Scanner with no code changes. This project has no collection path out of
  the box at all ([§4.3](#43-there-is-no-shipped-collector-and-that-is-the-design)).
- **Unlimited users on every tier including Free.** Visual review is a team
  activity; Percy does not tax the reviewers.

### Chromatic

- **Zero-authoring test discovery.** If stories exist, tests exist. Play
  functions run as interaction tests before capture
  ([docs](https://www.chromatic.com/docs/storybook/test/)). Here the operator
  writes a collector — 234 lines in the only worked example, once
  ([§4.3](#43-there-is-no-shipped-collector-and-that-is-the-design)).
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
  This project has an accumulation design and no accumulated data.
- **Fingerprint-scoped ignores.** An ignore is a (test, diff-shape) pair, not a
  muted screenshot and not a masked coordinate region, so silencing a known flake
  does not blind the suite to a different regression in the same image. The
  implementation is public
  ([mask-fingerprint](https://github.com/argos-ci/mask-fingerprint)).
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
- **Triage that scales by grouping.** Steps are clustered by the *shape* of their
  diff regions and one accept propagates across the batch
  ([maintenance](https://applitools.com/docs/eyes/concepts/reviewing-tests/test-maintenance)).
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

The cause/collateral split is also where this project's own reporting was wrong
until 2026-08-02, which is worth stating because it is the claim being made. A
`prop` root — `Panel → Button`, meaning `Panel` passed something new — was
labelled correctly on the docket entry and then attributed to `Button` in the
per-component roles the report actually prints. A reviewer following it opened a
file nobody had edited. `Root.cause` now records the responsible component;
`packages/dom/src/attributed.test.ts` asserts the distinction.

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

Supporting measurements:

| Claim | File | Result |
|---|---|---|
| Owner chains resolve to component display names, without the React DevTools hook | `packages/react/src/provenance.test.ts` (23 tests) | Against React 19.2.8 |
| Portals belong to the subject by component tree, not DOM containment (ADR-0007) | `packages/dom/src/portal.test.tsx` (6 tests) | Container hash is byte-identical whether the dialog is open or closed. The **342 bytes** that move is a one-off corpus measurement from journal 0003, restated as prose at `packages/react/src/portal.ts:12` and asserted by no test |
| Semantic diff separates root from collateral; token attribution | `packages/core/src/compare/diff/diff.test.ts` (29 tests) | — |
| `impact` (`layout`/`paint`/`composite`) as an axis orthogonal to bands | `packages/core/src/compare/diff/impact.test.ts` (18 tests) | `--brand` → `token/paint`; `--space` → `token/layout` (journal 0009) |
| Component → file by reading the repo, with no build plugin | `packages/core/src/attribute/source.ts`, `examples/todomvc/src/source-index.ts` | **A regex scan**, not a source map — `_debugSource` is gone in React 19, so this is deliberate. It misses components produced by a factory, assigned dynamically or re-exported under another name, and can name a capitalised non-component; a name declared in two files is reported as ambiguous rather than guessed. Limits stated in `source.ts`. **No dedicated test**; exercised only end-to-end on one example app |
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
- **No Vue, Svelte or Angular application has been run through this.** What was
  written here until 2026-08-02 was stronger and wrong: "provenance is
  React-only", stated as a property of the approach. It was a count of
  implementations. `collect()` takes `provenanceOf` as a caller-supplied
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
  The corpus contains no reindentation case. This document states a false-*miss*
  rate twice — here and at [§4.5](#45-targets-never-measured-and-limits-never-tested)'s
  0/20 — and has never measured a false-alarm rate.
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
suffers is an argument, not a finding. Nobody has reported it to this project,
and [§4.1](#41-nothing-has-ever-recorded-a-history-row) records that the pipeline
has never produced the example once.

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
[§4.1](#41-nothing-has-ever-recorded-a-history-row).

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

Everything below the CLI boundary is implemented and unit-tested. One part of it
— **normalize, collect, provenance, diff and band** — is additionally scored
against ground truth declared before the pipeline existed. The rest — docket,
region, impact, raster phases, stores, sessions, history, the history service,
MCP — is tested against constructed inputs, fakes and fixtures. That is a weaker
claim and it is treated as one throughout this section:
[§4.1](#41-nothing-has-ever-recorded-a-history-row) says spec 0002's acceptances
are met "against hand-constructed rows", `store-lfs.test.ts` injects a fake
`CommandRunner` in every test but one, and `buildDocket` is exercised at 3
subjects.

Everything **at and above** the CLI boundary is written and has never been run
against anything real.

**Corrected 2026-08-03.** When this section was written the repository's own
prose did not say so — `README.md` still stated there was no CLI and no history
while ~16k lines implementing both had landed in commits `e76bf0f`, `9be72b3`,
`de7e8db`, `673c4a7`, `2e683d3` and `66f4662`, and every file in `docs/specs/`
still carried one undifferentiated status. That is fixed: there are nine specs
carrying four distinct statuses, the `Status` column in
[`docs/specs/README.md`](specs/README.md) says which is which, and the string
"specified, not built" appears nowhere. The finding this section makes — written
is not run — survives the correction, and §4.1 onward is where it is evidenced.

### 4.1 Nothing has ever recorded a history row

`hashComponents`, `observationsFrom` and `createHttpHistoryStore` are called by
**no non-test code anywhere** — verified by grep across `packages/*/src` and
`examples/*/src`; the only hits are the definitions and the re-exports in
`packages/core/src/attribute/index.ts:34` and `packages/history/src/index.ts:19,51`.
`variance run` does not record. `variance accept` explicitly refuses to
(`packages/cli/src/commands/accept.ts:38`: "It does not write to the history
store… the hashes are not in it and cannot be derived from it").

Consequence: spec 0002's five acceptance criteria are all satisfied against
hand-constructed rows. There is a hashing tier, an arithmetic tier and a storage
tier, and **no wire between the first and the second**. The 22px story in
[§3.4](#34-accumulation-as-text-not-pixels) has never once been produced by the
pipeline.

### 4.2 Nothing above the CLI boundary has been run

- **`variance run` now completes against a real project. Corrected 2026-08-02.**
  This entry previously read "no `variance run` has ever completed against a real
  project", and that is no longer true: `cases/storybook-case` carries a
  `variance.config.json`, a collector the operator writes
  (`cases/storybook-case/collector/`), and
  `cases/storybook-case/src/cli.chromium.test.js`, which spawns the binary over a
  Storybook built by Storybook and asserts the whole cycle —
  **new (exit 1) → accept (0) → unchanged (0) → 5 of 8 changed (exit 1)** on a
  build with one component edited, finding exactly the five stories that render
  it. The CLI reaching the verdicts the library reaches is demonstrated against
  `storybook-case` rather than against todomvc, which is the stronger of the two
  because the subjects are not ours.

  **The first execution found five defects, and three made durable mode
  unusable** (journal 0014): the run never exited, because nothing closed the
  renderer `deps.renderer()` opened; `stabilization` was dropped by the identity
  wire codec, so `accept` stored a baseline under a different digest than the next
  `run` looked it up with and every subject came back `incomparable` forever; and
  the refusal that produced named the same machine on both sides, because
  `describeIdentity` omitted the two fields the digest covers. Plus a coverage
  section printed twice, and component names lost to a minifying build.

  That is the value of the entry rather than an argument against it: 28 cases in
  `packages/cli/src/commands/run.test.ts` with a fake `Collector` and a fake `Renderer` could not have found
  any of them. What is still unrun: `variance serve` (MCP over stdio) has no test
  file of its own, and `variance run` has never been executed against a
  repository this project did not write.
- **git-LFS has never been exercised as git-LFS.** `store-lfs.test.ts` injects a
  fake `CommandRunner` in every test but one; the single real-git test does
  `git init` and checks `git check-attr` resolves the filter. git-lfs is never
  installed, no clean/smudge filter runs, no image is committed. Spec 0004
  acceptance 1 — "the working tree contains a pointer rather than the image" — is
  untested.
- **Linux verification has not been run.** `docker/linux-verify.Dockerfile` and
  `docker/linux-verify.sh` exist; `docker/results/` does not, and there are no
  `.log` files in the tree. Nothing it was built to establish is established,
  including the one that matters most: "a semantic verdict that differs across
  platforms refutes ADR-0010."
- **CI integration is committed and has never run.**
  `.github/actions/variance/{action.yml,locate-artifacts,post-comment}`
  and `.github/workflows/variance.yml` all exist and are tracked (commit
  `2e683d3`, corrected by `66f4662`); `packages/cli/src/commands/comment.ts`
  renders the body as a pure function and is covered by `comment.test.ts` (16
  tests). The workflow is not a stub — it pins a container so baselines stay
  comparable with `docker/linux-verify.Dockerfile`, and it refuses
  `pull_request_target` with a written rationale. What has never happened is a
  run: the workflow's first step checks for a `variance.config.json` this
  repository does not contain and no-ops, so no job has launched a browser, no
  artifact has been uploaded, and no pull request has ever been commented on.
  What [ADR-0019](context/adr/0019-one-comment-that-leads-with-causes.md)
  decided is therefore unproven by execution rather than by absence of code.
- **The MCP layer has never served an agent.** Five tools shaped by argument
  about what an agent needs, tested against text (`packages/mcp/src/mcp.test.ts`,
  27 tests, including chunk-boundary reframing).

### 4.3 There is no shipped collector, and that is the design

`loadCollector` in `packages/cli/src/commands/run.ts` imports a module *the
operator writes*, named in the config rather than discovered. `planStorybook`
produces only a plan, and the Storybook package's driver — `collectStory` /
`collectStories` — is not imported by the CLI at all.

**Corrected 2026-08-02:** one now exists as a worked example.
`cases/storybook-case/collector/` is 341 lines across three files including its
comments — 234 of them in the module the config names
— it serves its own build, declares which stories carry a readiness marker, and
indexes its own source for component→file — and it is what the end-to-end run in
[§4.2](#42-nothing-above-the-cli-boundary-has-been-run) is driven by. So "an
operator writes about thirty lines" is now a claim with a file behind it rather
than an estimate, and the number is closer to a hundred.

What has not changed is that a buyer comparing integration surfaces should read
this as a cost. Percy ships 20+ SDKs and Argos takes any PNG from a CLI; here the
mounting half is the adopter's to write, once, per project.

### 4.4 The Storybook adapter and the CLI have both met a Storybook

**Corrected 2026-08-02, after `cases/storybook-case` landed.** This section
previously read "has never met a Storybook", and that is no longer true: Storybook
is installed in the repository, `storybook build` produces `storybook-static/`,
and `cases/storybook-case/src/storybook.chromium.test.js` drives the real preview
against the `index.json` Storybook itself wrote. It also produced a finding the
fixtures could not — the readiness gap, reproducibly: captured on Storybook's own
`storyRendered` the deferred story is `loading…`, and captured on a declared
marker it is the component. Two of the three things
[ADR-0020](context/adr/0020-read-the-artifact-not-the-configuration.md) claims are
demonstrated here: no fixture in the loop, and one browser with one navigation
over N stories.

What is **not** demonstrated is the third — that Storybook's own chrome
contributes no rules to a subject, which is the exact case ADR-0003 was written
for and is not asserted anywhere — nor the CLI hop above it. The CLI still imports only
`readStoryIndex`, `storySubjectId` and `toSubjects`; `collectStory` /
`collectStories` are exercised by the case and not by a run
([§4.3](#43-there-is-no-shipped-collector-and-that-is-the-design)). Under the fixtures, what was already
proven stands: v3/v4/v5 index parsing (`index-file.test.ts`, 22), subject mapping
with per-story exclusion and viewport (`subjects.test.ts`, 17), and a preview
driver that reports a throwing story as a subject rather than crashing the run
(`packages/storybook/src/preview.test.ts`, 33).

### 4.5 Targets never measured, and limits never tested

- Spec §10's M0 targets: `<2% false semantic misses on no-op refactors` is
  **met** (0/20) — a false-*miss* rate. The corresponding false-*alarm* rate was
  never a target and has never been measured, and one false alarm is demonstrated
  ([§3.3](#33-deciding-at-the-cheapest-representation-that-can-decide)).
  `>70% screenshot-skip on typical PRs` and `0 baseline breakage
  across rebase` were never measured — there is no repository with PRs and no
  rebase experiment.
- Spec §10 asked for two real component libraries. Zero have been used.
- Spec 0002 records that one service process owns one SQLite file and that
  concurrent CI jobs serialize through it. There is **no concurrent-writer test**
  in `packages/server/src/`. `node:sqlite` is experimental on Node 22 and the
  suite emits `ExperimentalWarning` on every run.
- Module-level state — a singleton store, a cached client — is outside the DOM
  and therefore outside the session probe. Confirmation catches the symptom;
  attribution correctly reports no culprit. Stated in ADR-0009 with no path to
  closing it.
- Every pixel number carries the same unmeasured axes: `deviceScaleFactor: 1`,
  screenshots clipped to `#subject` rather than the viewport (journal 0010 notes
  this flatters the pixel arm's byte count and that a full-page tool would be
  ~6× the bytes), one engine, one font stack, `color-scheme: light` pinned.

---

## 5. When not to choose this

The differences in [§3](#3-where-this-project-is-genuinely-different) only matter
under specific conditions. Where those conditions do not hold, one of the four
products above is the better answer, and in most cases it is not close.

**Do not choose this if any of the following is true.**

| Condition | Why it disqualifies | Go to |
|---|---|---|
| **Something is needed this quarter** | Nothing above the CLI boundary has been run once. Adopting this means finishing it | Any of the four |
| **The frontend is not React, and nobody will add a build plugin** | Provenance needs a name per element. React gets it from fiber traversal; anything else gets it from two `data-*` attributes, which is a build-step change somebody has to make and own. Without either, diffs resolve to a DOM path — what every competitor already gives, with support. On React the traversal reads unversioned internals verified only against **19.2.8**; ADR-0005 names three internal contracts, and the third fails *silently*, returning props digests one render stale. A React upgrade is a re-verification event, not a version bump | Argos, Chromatic |
| **Cross-browser or cross-device coverage is the requirement** | One Chromium. No Firefox, no Safari, no Edge, no mobile, no real devices | Applitools (one Page covers the matrix), Percy, Chromatic |
| **Non-engineers must review** | There is a JSON report and five MCP tools. No dashboard, no approval UI, no threaded discussion, no invite flow | Chromatic (UI Review), Percy, Applitools |
| **Cost predictability matters more than cost structure** | There is no unit and no bill, but also no ceiling on the engineering time to operate a spike. A published $0.004/screenshot with a spend cap is a more predictable number than "your own infrastructure" | Argos |
| **Longitudinal flake data is needed now** | Argos already ships per-test flakiness scores, fingerprint-grouped recurrence, and an audited ignore register. Here, the history tier is written and has never recorded a row ([§4.1](#41-nothing-has-ever-recorded-a-history-row)) | Argos |
| **Storybook is the test surface and coverage should be automatic** | Chromatic turns every story into a test with no authoring, and maintains Storybook. Here the operator writes the collector — about a hundred lines, once, per project ([§4.3](#43-there-is-no-shipped-collector-and-that-is-the-design)) | Chromatic |
| **The content under test is canvas, WebGL, video, or heavy third-party iframes** | The bitmap lives in a rendering context, not the document. This is structural, not a missing feature | A pixel differ — any of them |
| **Regulated data with a contractual residency requirement, plus a vendor to sign it** | Self-hosting solves the residency problem and creates a supplier-risk problem: the supplier is a spike with no support commitment | Applitools (real on-premise), or Percy Enterprise GRR |
| **A team that will not maintain its own tooling** | Every property in [§3](#3-where-this-project-is-genuinely-different) is bought with operator effort that the SaaS products absorb | Any of the four |

**The conditions under which the differences do matter**, stated as narrowly as
the evidence supports:

- A React codebase where the recurring cost is not *detecting* changes but
  *triaging* them — where the question after a red build is consistently "which
  component did this" and the answer is currently a bisect.
- An environment where application markup cannot leave the network, and where
  Applitools' on-premise Eyes is either too expensive or too much product.
- A team that would rather read the diff engine than trust a score, and has the
  appetite to finish the parts marked unrun in [§4](#4-what-is-written-and-unrun).
- An agent-driven workflow where the consumer of the report is a program, and
  `Text src/ds/components.tsx:42` is actionable in a way that a red rectangle is
  not. This is the strongest case for the design and the weakest case
  evidentially: the MCP surface has never served an agent.

**There is no evaluation path.** A reader who agrees with every condition above
still has nowhere to go: nothing is published, nothing is licensed, every package
is `private: true`, and the collector that mounts an adopter's own components is
theirs to write. Nobody can trial this against their own codebase today.

**Corrected 2026-08-03.** This paragraph also claimed the CLI had never completed
a run and that the repository contained no `variance.config.json`, both of which
[§4.2](#42-nothing-above-the-cli-boundary-has-been-run) had already refuted
higher up the same document — `cases/storybook-case/variance.config.json` is
tracked and the cycle runs. It named `packages/core/src/compare/diff/` as
`packages/core/src/diff/`, a directory that does not exist. Three errors in one
paragraph, none caught by `tools/docs-links.test.ts`, because a stale
*negative* resolves no link and a directory carries no extension for the path
rule to check. Written-and-unrun sections rot in the one direction the gate
cannot see: they stay pessimistic after the work lands.

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
