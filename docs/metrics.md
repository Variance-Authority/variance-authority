# Metrics

The axes on which this project could be shown to beat Percy, Chromatic, Argos and
Applitools, stated as procedures rather than claims.

**Written 2026-08-02.** Companion to [`comparison.md`](comparison.md), which
states where each competitor currently wins and why most readers should buy one
of them. This document does not repeat that. It answers a narrower question:
*if someone wanted to settle the disagreement with a number, what would they
run?*

Nothing here has been run. Every metric below is a design for a measurement, not
a result. Where a figure already exists in this repository it is quoted with the
file that produces it and marked **measured**; every other number in this
document is a target, a threshold, or an estimate, and is marked as such. The
ranking in [§4](#4-ranking) is the useful part for anyone deciding what to build
next, and [§4.3](#43-where-the-two-rankings-disagree) is the part that argues
against this project's own priorities.

Three of the nine metrics cannot be run against this project today at all,
because the code paths they would measure have never executed
([comparison §4](comparison.md#4-what-is-written-and-unrun)). That is stated per
metric rather than collected into a caveat at the end.

---

## 1. The instrument comes first

Every metric below is a fraction, and a fraction is only as good as the corpus in
its denominator. This repository has already demonstrated the failure mode: the
kitchen-sink corpus scored **30/37** on its first jsdom run and **31/39** on its
first chromium run, the implementation was repaired nine times in response, and
the published figures are **38/38** and **39/39**
([comparison §3.3](comparison.md#33-deciding-at-the-cheapest-representation-that-can-decide)).
All nine repairs were real defects and the corpus earned its keep by refuting the
implementation — but 38/38 is agreement *after* fitting, on the only corpus that
exists, written by the same people who wrote the code.

None of the metrics below mean anything measured that way. So the protocol comes
before the metrics.

### 1.1 Two corpora, and neither is ours

**Corpus H (harvested).** 40 commits taken from the history of third-party React
repositories that ship a Storybook. Selection rule, fixed before any commit is
read: commits touching at least one file under a components or styles directory,
excluding merge commits, excluding commits that also change the build
configuration, sampled uniformly from the last 500 matching commits of each
repository. **Ground truth is the commit's own diff** — git says which files
changed, and no tool author gets a vote. This is the only ground truth in the set
that is genuinely independent of everybody's implementation, including ours.

Stratification is mandatory, because an unstratified number hides the fact that
this project ties with Chromatic on half of it:

| Stratum | Why it is separated |
|---|---|
| Component-level story | Chromatic's story title already names the component. Attribution is not a differentiator here |
| Page-level or composed story | Every competitor's answer collapses to "this page moved" |
| E2E / route-level subject | Same, and neither Chromatic nor this project has a story to lean on |
| Non-React subject | This project scores 0 by construction. Included so the headline is not quietly React-only |

The **weight** of each stratum in a real suite is itself an unmeasured quantity,
and it decides how large the attribution win actually is. Measure it: over the
same third-party repositories, the share of visual subjects that are
component-level versus page-level. If page-level subjects are 10% of a typical
suite, the axis this project is built around is worth 10% of a suite.

**Corpus S (synthetic).** Scripted edits where a property has to be controlled
that harvested commits will not supply on demand — a no-op refactor, a 1px
padding change, a canvas repaint. The mechanism exists:
`examples/todomvc/src/mutations.ts` already declares each edit's layer, intent
and whether it changes what a camera would see, and
`examples/todomvc/src/code-mutation.ts` records why a prop change and a source
change are different causes with different correct attributions. That file is the
template. What it is not is a corpus: 9 mutations on one self-authored app.

**Corpus S is weaker evidence than Corpus H and must be reported separately.** An
edit we wrote, applied to an app we wrote, scored by a tool we wrote, is three
degrees of self-selection. It is admissible only where Corpus H structurally
cannot answer the question.

### 1.2 Standing rules

These apply to every metric. They exist because the alternative has already
happened once in this repository.

1. **The corpus is committed and frozen before the first run.** A commit hash for
   the corpus appears in every reported result.
2. **The first run is published, including if it is bad.** 30/37 is the number
   that made the corpus worth having.
3. **An implementation change after a run invalidates that run.** Re-running
   after a fix produces a fitted number, and a fitted number is reported as
   fitted or on a fresh stratum, never as the headline.
4. **Three runs, spread reported, never the best.** `docker/linux-verify.sh`
   already encodes this rule for the platform experiment and gives the reason: a
   single run cannot distinguish a platform difference from a loaded machine.
5. **A free-tier measurement names what the free tier is missing.** Percy's
   Visual Review Agent is not on Free — the headline noise-reduction feature,
   absent from the tier most exposed to review fatigue. Chromatic Free is
   Chrome-only. Reporting a free-tier number as the product is dishonest in
   exactly the direction that flatters us.
6. **One machine is never a product property.** Every existing number in this
   repository is one M-series Mac and one Chromium build.

### 1.3 What can be measured against whom

| Vendor | Measurable without a paid account? | Constraint |
|---|---|---|
| **Percy** | Yes | Free: 5,000 screenshots/month, all desktop browsers, unlimited projects. A 40-case corpus at one width and one browser is ~80 screenshots per experiment — roughly 60 experiments per month fit the free tier. JS is disabled by default on re-render; a corpus with runtime-JS subjects measures Percy's default, which is fair only if declared |
| **Chromatic** | Yes | Free: 5,000 snapshots/month, **Chrome only**, no accessibility testing, hard-stops at the cap rather than degrading. Requires Storybook, Playwright or Cypress |
| **Argos** | Yes | Free: 5,000 screenshots/month. Rendering is in the customer's CI, so the CI cost of the experiment is ours — which is what makes it the only apples-to-apples cost comparison in the set |
| **Applitools** | **No** | There is no free tier. The ToS grants a Free Trial for *internal non-commercial evaluation*, capped at 100 Checkpoints/month, one Permitted User whose credentials cannot be shared, terminable at any time. A published competitive benchmark is outside that grant. A paid measurement means an annual contract with no public price — a procurement project, not an afternoon |

**Consequence: every Applitools cell in every metric below is documented
behaviour, not a measurement, and must be labelled that way.** This is the
largest hole in the whole programme, and it is worst precisely where Applitools
is strongest — review grouping ([M2](#m2-review-items-per-real-change)) and the
browser-matrix cost model ([M3](#m3-wall-clock-and-ci-cost-per-subject)).

---

## 2. The metrics

Each states the procedure, the unit, what it costs to run, and the result that
would mean this project loses.

### M1. Attribution rate

**Procedure.** For each changed subject in Corpus H, take the tool's output and
record whether it names (a) the component that produced the changed pixels and
(b) a repository-relative `file:line`. Score the tool's **top-ranked** entry
only, not its full list — a tool that names twenty files is not attributing.

**Unit.** Three counts per stratum, not one rate:

| | Meaning |
|---|---|
| `named-correct` | A file was named and it is in the commit's changed-file set |
| `named-wrong` | A file was named and it is not |
| `not-named` | No file offered |

`named-wrong` is the number that matters. A confident wrong file sends an agent
to edit the wrong thing and is worse than the competitor's honest silence.
Report top-3 recall separately as a secondary figure.

**Where each tool stands before the run** (documented behaviour, 2026-08-02, per
[comparison §1](comparison.md#1-the-dimensions-a-buyer-actually-decides-on)):
Percy stops at a CSS class or tag; Applitools at a DOM path and changed CSS
properties; Argos carries the *test spec's* file and line, not the product code's.
All three score `not-named` = 100% on the file half. Chromatic scores
`named-correct` on the *component* half by construction for component-level
stories, and collapses on the page-level stratum.

**Cost to measure.** The corpus is 5–8 engineer-days. Wiring each hosted
competitor is ~1 day each and $0 on free tiers. Applitools is documentation only.
**The gating cost is not the benchmark — it is this project.** `loadCollector` in
`packages/cli/src/commands/run.ts` imports a module the operator writes, the
Storybook adapter has never met a Storybook, and no `variance run` has ever
completed ([comparison §4.2–4.4](comparison.md#42-nothing-above-the-cli-boundary-has-been-run)).
M1 cannot be run against this project until that is closed, and closing it is
product work, not measurement work.

**What would mean we lose.** Because three competitors are at a structural zero
on the file half, a relative comparison is meaningless — any nonzero rate "wins"
and the win means nothing. The falsifier is therefore absolute:

- `named-correct` below **50%** on Corpus H's page-level stratum. Below that, the
  reviewer is back to bisecting on half the cases and the workflow has not
  changed.
- `named-wrong` above **5%**. Above that the field cannot be trusted, and an
  untrusted field is worse than an absent one.
- On the component-level stratum, no measurable advantage over Chromatic. This is
  the expected result, not a risk — the story title already names the component.

The predicted failure modes are named in `packages/core/src/attribute/source.ts` itself: a
regex scan misses components produced by a factory, assigned dynamically, or
re-exported under another name, and can name a capitalised non-component. None of
those have ever occurred in a measurement, because the only measurement resolved
all three lines to one 143-line file that declares all seven of the example's
components — so the component→*file* hop is currently untested by the one capture
that appears to test it.

### M2. Review items per real change

The "300 diffs, one cause" axis.

**Procedure.** Apply a single-cause change — one design-token edit — to a corpus
of S subjects where S ≥ 40 and the token demonstrably reaches most of them. Count
what the reviewer is handed.

**Unit.** Two numbers, and the second is the one that matters:

- **M2a — items per cause.** Discrete review items presented, divided by causes
  applied. Ideal for a one-token change: 1.0. A pixel differ with no grouping:
  S.
- **M2b — grouping precision.** Construct the adversarial case: two *different*
  token edits that produce similarly-shaped diff regions in different components.
  Score the share of presented groups that contain exactly one cause. A merged
  group means one accept silently approves an unreviewed second change.

Record separately whether a bulk "accept all" exists and whether it is
*informed* — whether the tool told the reviewer the changes share a cause.
Accept-all without that is not grouping, it is abdication, and counting it as
M2a = 1.0 would flatter every tool in the category including this one.

**Where each tool stands.** Applitools is the real competitor here and it is not
close to absent: steps are clustered by the *shape* of their diff regions and one
accept propagates across the batch. Percy, Chromatic and Argos group by fingerprint
or not at all. This project groups by root id — `buildDocket` in
`packages/core/src/judge/docket.ts` aggregates by a root id constructed to be stable
across subjects, so `token:--color-primary` is the same root wherever it lands
and the grouping needs no similarity heuristic.

**That is the whole bet, and it is why M2b matters more than M2a.** A shape
heuristic and an exact key give the same answer on the easy case and diverge on
the adversarial one.

**Cost to measure.** 1–2 days on top of M1's corpus, plus a design-system
repository with a genuinely shared token. Free tiers are sufficient (40 subjects
× 2 runs = 80 screenshots). Applitools cannot be measured, which is unfortunate
here specifically, because Applitools is the tool this metric was designed to
separate us from.

**What would mean we lose.**

- M2a above 1.0 on a single-root change — the docket failed to collapse.
  `buildDocket` has been exercised at **3 subjects**
  (`packages/core/src/judge/docket.test.ts`, 12 tests, constructed diffs). "One token,
  300 collateral, one action" is demonstrated at 3, not 300, and the failure at
  40 is entirely plausible.
- M2b below Applitools' shape-clustering precision on the adversarial case. If an
  exact key does not beat a heuristic on the case designed to break the
  heuristic, the key is not buying anything.
- Any case where two distinct causes land in one group. One is enough to fail
  this; the whole claim is that the group *is* the cause.

### M3. Wall-clock and CI cost per subject

**Procedure.** One repository, one fixed subject set, one PR. Measure four
quantities and never collapse them into one:

| Quantity | Unit | Why separate |
|---|---|---|
| CI machine-seconds | seconds | Percy, Chromatic and Applitools move rendering to their fleet, so theirs is near zero and the cost is elsewhere |
| Vendor units consumed | screenshots / snapshots / Pages | The billing unit, which differs structurally per vendor |
| Dollars at list price | $/month at 100 PR builds | The only number a buyer acts on |
| Wall-clock to verdict | seconds from push to a status check | The number a developer feels |

A single "cost per subject" would flatter whichever architecture it was pointed
at. The vector does not.

**The number to beat is already known and it is small.** A 200-component library
at 3 viewports and 100 PR builds/month is 240,000 raw units — about **$283/mo**
on Chromatic Starter with TurboSnap, or **$407/mo** on Argos Pro at the Storybook
rate ([comparison §1](comparison.md#the-one-commercial-fact-worth-isolating)).

**This project's side of it, estimated and never operated**: the same 600
subjects cost about 4.5 CI-seconds of warm semantic capture at the measured
7.5 ms, plus about 39 seconds if every subject also reaches the raster tier at
the measured 65.4 ms — single-digit CI-minutes with build and browser install,
cents at any runner price. Both of those millisecond figures come from scripts no
test asserts (`examples/kitchen-sink/scripts/bench.mjs`,
`examples/todomvc/scripts/pixel-arm.mjs`), on one Mac, with screenshots clipped
to `#subject` rather than the viewport — journal 0010 notes that clipping
flatters this arm's byte count and that a full-page tool would be roughly 6× the
bytes.

**Cost to measure.** ~2 days of harness work. Honest wall-clock against hosted
vendors requires a **paid** month — free-tier queue delay is not a product
property — so about **$279** for one month of Chromatic Starter plus Argos Pro.
Applitools requires an annual contract and cannot be included.

**What would mean we lose.**

- CI machine-seconds per subject above Argos's. Argos is the only architectural
  peer — rendering in customer CI — so this is the one directly comparable cell,
  and losing it means the two-tier design is not buying the time it was drawn to
  buy.
- Total cost of ownership above $283/mo once operator time is amortized at any
  plausible engineer rate. **This is the likely outcome and it cannot be measured
  in advance.** The compute is cents; the bill is the engineering time to finish
  the unrun work and then operate it, and nobody has done any of it. Until
  someone has operated this for a quarter, the honest report on this axis is that
  the compute is cheap and the total is unknown — which is a worse answer than
  $283/mo, because $283/mo is a number.

### M4. False-verdict rates, both directions

The metric designed to hurt. This repository states a false-*miss* rate twice and
has never measured a false-*alarm* rate
([comparison §4.5](comparison.md#45-targets-never-measured-and-limits-never-tested)).

**Procedure.** Two corpora with opposite ground truths, and a published arbiter
for "user-visible".

**Arbiter.** A change is user-visible iff a full-page screenshot at
`deviceScaleFactor: 1` in the reference browser differs under **odiff at the
thresholds Argos publishes** (0.15 and 0.0225, antialiasing on). Argos's are the
only published thresholds in the category, and using a competitor's arbiter
removes the most obvious way to fix the result. Note the circularity honestly:
this makes a pixel differ the judge, so the *alarm* direction cannot be scored
against a pixel differ this way and needs the second corpus below.

**M4a — false alarm.** 40 scripted no-op transformations: reindentation, comment
insertion, import reordering, local variable rename, prettier reflow, dead-code
removal, subexpression extraction. Each verified at 0 px by the arbiter before
being admitted. Score: share reported as changed or needs-review.

**M4b — false miss.** 40 real changes stratified by magnitude and by mechanism:
1px padding, one shade of a colour, a font-weight change, an image swapped behind
a stable URL, a canvas repaint, an animation caught mid-flight, an edit inside a
cross-origin stylesheet. Score: share reported as unchanged.

**Predicted results, from measurements this repository already has.**

| Probe | This project | Source |
|---|---|---|
| Text smoothing mode | unmoved; pixel arm moves **177 px** | `examples/todomvc/src/pixel.chromium.test.ts` (**measured**) |
| Device pixel ratio | different environment key, never compared; pixel arm moves **3015 px** | same (**measured**) |
| Reindented JSX inside a block | **0 px rendered, hash moves — a false alarm** | same (**measured**) |
| Canvas repaint | **blind, and the test asserts the blindness** (`renderHeld === true`); 857 px at default allowlist, 2031 px strict | same; magnitude from `scripts/pixel-arm.mjs`, asserted by no test |
| Cross-origin stylesheet edit | fingerprints as `unreadable`, compares **equal** | `docs/flakiness.md` |
| Image swapped behind a stable URL | assets are caller-supplied content hashes — **blind** | `packages/dom/src/collect.ts:81` |

So the expected outcome is split: **we win M4a on rasterization causes and lose
at least one case (reindentation) that every pixel differ gets right; we lose
M4b outright on every non-DOM stratum.** Report the full-corpus number first and
the DOM-only number second. Leading with the DOM-only number would be the
category's oldest trick — declaring the cases you fail out of scope and then
quoting the remainder.

**Cost to measure.** M4a is scripted and cheap, ~2 days. M4b needs the
stratification and the arbiter harness, ~2 days. Free tiers are sufficient for
all three measurable competitors. The existing evidence base is one no-op
stratum: spec §10's `<2% false semantic misses on no-op refactors` is met at
**0/20**, which is a 20-case denominator on one self-authored corpus.

**What would mean we lose.**

- M4a above any pixel differ's rate on the no-op corpus. One false alarm is
  already demonstrated, so this is live.
- M4b above a pixel differ's rate on the **DOM-only** stratum. Losing the
  full-corpus number is expected and structural; losing the DOM-only number means
  the semantic representation is not seeing things it claims to see.
- Any case where a change is reported `unchanged` that the arbiter calls visible
  and that is not on the declared blind-spot list in [M9](#m9-blind-spot-inventory).
  An undeclared miss is the worst single result in this document.

### M5. Cross-machine stability

**Procedure.** The same subject set at the same commit on K ≥ 4 machines: macOS
arm64, Linux x86_64 container, Linux arm64 container, and a hosted CI runner.
Two distinct questions, and conflating them is how this axis gets faked.

- **M5a — same environment key, different host.** Identical container image, two
  hosts. Verdict disagreement rate. **Must be 0.**
- **M5b — different environment key.** Cross-platform pairs. Record the
  classification split: `incomparable` (correct by design), `unchanged`,
  `changed`. A cross-platform `changed` is a false alarm the environment key was
  supposed to absorb.

**Pair it with a usefulness measure, or it is gameable.** A tool that answers
`incomparable` to everything scores perfectly on M5b and is useless. So also
record: share of subjects producing an actionable verdict at all on the second
machine. `incomparable` is a refusal, not an answer.

**The competitors win this axis by removing the variable, and that should be said
plainly.** Percy, Chromatic and Applitools re-render on their own fleet, so the
customer's machine does not enter the comparison; Chromatic additionally
auto-migrates baselines across its *own* infrastructure upgrades, which is the
vendor absorbing a mass false-positive event most hosted competitors hand to the
customer. The experiment against them is different in shape — capture from two
different customer machines and see whether the vendor's verdict moves — and it
is a fair test of the DOM-snapshot architecture, but their expected score is
high. This project's only available claim is the narrower one: when a difference
exists, it is named rather than surfaced as unattributable red.

**Cost to measure.** The cheapest unrun metric in the set.
`docker/linux-verify.Dockerfile` and `docker/linux-verify.sh` already exist and
already run the suite three times; `docker/results/` does not exist and no run
has happened. ~1 day plus a Docker host and one cloud runner of a second
architecture. Against hosted vendors, ~1 day each on free tiers.

**What would mean we lose.**

- Any M5a disagreement. Same image, two hosts, different verdict is
  disqualifying.
- Any cross-platform `changed`. The predicted mechanism is specific: fonts are a
  caller-supplied **string, not a content hash**, so a second machine can render
  different geometry and the key will not say so — and the metric probe reports
  metric-compatible substitutes, which is exactly what a Linux container ships,
  as *missing*. That false-alarm rate has never been measured.
- A semantic verdict differing across platforms, which `docker/linux-verify.sh`
  states in its own closing lines **refutes ADR-0010** and is the finding rather
  than a failure to be retried away.

This is the one metric where the repository has pre-committed to what a bad
result means. Run it first for that reason alone.

### M6. Time-to-first-verdict on a cold repository

**Procedure.** Stopwatch from `git clone` of a repository that has never used the
tool, to the first correct verdict on a real change, performed by an operator who
has read only the tool's public documentation and is not a contributor to it.
N = 3 operators per tool, to control for one person's familiarity.

**Unit.** Four numbers:

| | |
|---|---|
| Wall-clock minutes to first verdict | The headline |
| Files created or edited in the target repository | Integration weight |
| Lines of code the operator had to **write** | The line between configuration and implementation |
| External accounts created, and support contacts needed | Procurement friction |

**Where each tool stands.** Chromatic on a repo that already has stories is
plausibly `npx chromatic --project-token=…` and a single CI file. Percy has
`npx percy exec`, plus genuine no-code on-ramps — a URL list, a sitemap, a static
directory, or a crawler with no code changes at all. Argos is a CI step. All
three are single-digit files and zero lines of operator-written code.

**This project's current score is unbounded, and that is not a figure of speech.**
There is no LICENSE file, nothing is published, no `variance.config.json` exists
anywhere in the repository for a run to read, `loadCollector` imports a collector
module *the operator writes*, and no `variance run` has ever completed against a
real project. `--help` exits 0 and three commands exit 2 with specific operator
errors; that is the argument parser working, not a verdict.

**Cost to measure.** ~8 operator-hours across 5 tools plus coordination, and it
requires outside operators — anyone who has read this repository is disqualified.
Against this project it **cannot be run at all** until there is a shipped
collector, a published package and a license.

**What would mean we lose.** Today, everything. The target that would make this
non-embarrassing, stated so it can be checked later: **under 30 minutes** on a
repository that already has a Storybook, **≤ 2 files added**, **0 lines of code
written by the operator**. Until `loadCollector` stops requiring the operator to
write a module, the third of those is 0% and the metric is not runnable.

### M7. Cause/collateral ranking accuracy

**Procedure.** Over Corpus H, score whether the tool's **top-ranked** entry names
the component that was actually edited, rather than one that merely moved because
something above it changed size.

**Why this is separable from M1.** M1 asks whether a file was named at all. M7
asks whether the *right one is first*, which is the question a reviewer with
twelve entries actually has. The one existing measurement says ranking is the
harder half:

```
--- broken-toggle on page/todos--populated
what a pixel differ reports:  1530 pixels changed
what this reports:            5 region(s)
  cause       933px in 2 region(s) — Text     src/ds/components.tsx:42
  cause        86px in 2 region(s) — Toggle   src/ds/components.tsx:107
  collateral  511px in 1 region(s) — Stack    src/ds/components.tsx:27
```

`Stack` was never edited — only reflowed — and by area it outranks the actual
edit by roughly 6×. Ranked by area the report is wrong
(`examples/todomvc/src/observe.chromium.test.ts`, **measured**, journal 0013).

**This metric has a built-in null model, which makes it the best-value experiment
in the set.** Run the same corpus through area-ranking (what every region-based
differ can do) and through provenance-ranking, on the same masks, in the same
process. The competitor baseline requires no competitor account, no vendor
cooperation and no corpus of theirs — it is computable from our own pipeline with
the provenance input removed.

**Cost to measure.** ~1 day on top of M1's corpus. Cheapest evidence-per-day of
anything here.

**What would mean we lose.** Provenance-ranking top-1 accuracy not meaningfully
above the area-ranking null model. If area is as good, the fiber traversal, the
React-version coupling and the whole `cause`/`collateral` distinction are not
earning their cost. Note the current evidence: the finding rests on **one
mutation and one story**, and journal 0013 records that with no causes supplied
the fallback *is* area — "honest, and not good". N needs to go from 1 to 40 before
this is a result.

### M8. Accumulated drift detection

The README's headline story: a button gains 2px eleven times, each approved
correctly, and nobody ever sees the 22px.

**Procedure.** Construct a synthetic history of K commits, each making a
below-threshold change to the same token, each approved. At commit K, ask each
tool for the cumulative change. Score: the smallest per-commit increment for
which the tool reports the **sum** rather than K individually-unremarkable
approvals.

**Where each tool stands.** Structurally zero, all four. Percy accumulates
approval state, Chromatic accumulates baselines, Argos accumulates test
*stability*. None accumulate the resolved value of a design token, because none
capture it — and the missing piece is the capture, not the key: Chromatic keys to
a stable story id and Argos to a test fingerprint, either of which could hold a
token value.

**And this project also scores zero today.** `hashComponents`,
`observationsFrom` and `createHttpHistoryStore` are called by **no non-test code
anywhere**; `variance accept` explicitly refuses to write history. There is a
hashing tier, an arithmetic tier and a storage tier, and no wire between the
first and the second. The 22px story has never once been produced by the
pipeline.

**Cost to measure.** Unmeasurable until that wire exists. After it does, the
experiment itself is cheap — a scripted history and one query.

**What would mean we lose.** Two things, and the second is the serious one:

- Failing to report the sum at any increment, which would mean the arithmetic
  tier does not do what `packages/history/` was built for.
- **Nobody caring.** The comparison document already concedes that whether the
  sum of individually-correct approvals is a defect a team actually suffers is an
  argument, not a finding, and that nobody has reported it to this project. A
  metric on which we win by default and no buyer has ever requested is the
  definition of a vanity metric — see [§4.3](#43-where-the-two-rankings-disagree).

### M9. Blind-spot inventory

The metric a buyer should run *against* us. Reporting it is the price of
credibility on [M4](#m4-false-verdict-rates-both-directions).

**Procedure.** A corpus of changes that are visible by the M4 arbiter and
structurally invisible to the representation under test. For this project the
list is already known and mostly already written down: canvas and WebGL repaints,
video, cross-origin stylesheets, images swapped behind a stable URL, animations
caught mid-flight, and anything inside a third-party iframe.

**Unit.** Share of the visible-change corpus each tool cannot see by
construction, with the mechanism named per case. "By construction" matters: a
threshold that happens to hide a change is a different failure from a
representation that cannot encode it, and only the second is permanent.

**Cost to measure.** ~2 days, and most of it is assembling cases we already know
we fail. Against pixel differs the expected score is near zero — they see
whatever the camera sees.

**What would mean we lose.** We lose this one by design and the number is the
point. The falsifiable claim is narrower: that the inventory is **complete**. Two
allowlist gaps were found and closed in an afternoon at `ALLOWLIST_VERSION a2`,
and journal 0011's call for a systematic audit against the CSS property index has
not happened. **Two found in an afternoon is weak evidence there were only two.**
Any blind spot discovered by a third party that is not on the published inventory
falsifies the claim that the inventory is known — which is the only claim on this
axis worth making.

---

## 3. What none of these measure

Stated here so the ranking is not read as a scorecard of the category.

The axes that decide most purchases have no metric in this document because this
project has nothing to measure on them: browser and device coverage, a review UI
that a designer or PM can use without repo access, threaded discussion, approval
merge semantics across two branches, SLAs, SOC 2, a DPA, and someone to call.
[comparison §2](comparison.md#2-what-each-competitor-does-better-than-this-project)
covers those and the gap is not small. A benchmark suite that measures only the
axes its author chose is an advertisement with a methodology section.

---

## 4. Ranking

Two orderings of the same nine metrics. They do not agree, and the disagreement
is the finding.

### 4.1 By likelihood of winning

| Rank | Metric | Why | Main risk |
|---|---|---|---|
| 1 | **M7** cause/collateral ranking | Nobody attempts it, and the null model is measurably wrong (area outranks the real edit ~6×). Needs no competitor account | N = 1 today. Generality unmeasured |
| 2 | **M1** file attribution, page-level stratum | Three competitors are at a structural zero; Chromatic collapses on this stratum | `named-wrong` on a regex scan meeting third-party code for the first time |
| 3 | **M2b** grouping precision | An exact root id versus a shape heuristic, on the case designed to break heuristics | `buildDocket` tested at 3 subjects; Applitools not measurable |
| 4 | **M4a** false alarm, rasterization causes | Structural, and already measured: 177 px and 3015 px on the pixel arm, unmoved here | Reindentation is a known loss on the same corpus |
| 5 | **M2a** items per cause | Should beat Percy, Chromatic and Argos comfortably | Contested against Applitools, who cannot be measured |
| 6 | **M3** CI machine-seconds | The cheap tier is genuinely cheap | Only comparable against Argos; total cost of ownership is the number buyers use and it is unmeasurable in advance |
| 7 | **M5** cross-machine | Coin flip | The repository has pre-committed that a bad result refutes ADR-0010. Fonts are a string, not a content hash |
| 8 | **M4b** false miss | Lost on non-DOM strata by construction | — |
| 9= | **M8** drift | Unmeasurable: nothing has ever recorded a row | — |
| 9= | **M6** time-to-first-verdict | Unbounded today. No license, no package, no shipped collector | — |
| — | **M9** blind spots | Designed to be lost. Only the completeness claim is falsifiable | Two gaps found in one afternoon |

### 4.2 By how much a buyer cares

| Rank | Metric | Why |
|---|---|---|
| 1 | **M6** time-to-first-verdict | This *is* the evaluation. A buyer who cannot get a verdict in an afternoon never reaches metric two |
| 2 | **M4** false-verdict rates | The reason teams churn out of this category. Crying wolf gets the check disabled; missing regressions makes it worse than nothing |
| 3 | **M2** review items per real change | The daily cost. Everything else is felt once a quarter; this is felt on every red build |
| 4 | **M3** cost | Buyers act on dollars. But the number to beat is $283/mo — small enough to cap how much anyone can care |
| 5 | **M9** blind spots | Intensely, *after* something ships broken. Rarely during evaluation |
| 6 | **M1** attribution | Real, and smaller than this project assumes — see below |
| 7 | **M5** cross-machine | Same shape as M9: cared about after it bites. Buyers on hosted tools never think about it because the architecture removed the question |
| 8 | **M7** cause/collateral ranking | Subordinate to M1. Nobody shortlists on ranking quality |
| 9 | **M8** drift | Nobody has ever asked for it |

### 4.3 Where the two rankings disagree

**The vanity zone: M7, M1 and M8.** Ranked 1, 2 and 9= on likelihood of winning;
ranked 8, 6 and 9 on buyer care. This project's entire differentiating thesis
sits here.

The attribution case has a specific and measurable deflator. In a
Storybook-centric workflow the story *is* the component, so Chromatic's answer is
already sufficient for the most common subject shape, and the gap only opens on
page-level and E2E subjects. **The size of that stratum in a real suite has never
been measured by anyone, and it sets the ceiling on the whole axis.** If
page-level subjects are 10% of a typical suite, then M1 and M7 — the two metrics
this project is most likely to win — are worth 10% of a suite, and that is the
number to find out before building anything else. It is the cheapest measurement
in this entire document: count subjects in three public repositories.

M8 is worse. It is a metric we would win by default because no competitor
captures the token value, and it is the metric with the least evidence of demand
in the whole set — the comparison document itself records that nobody has
reported this problem to this project. Winning it proves the design works, not
that anyone wanted it.

**The inverse zone: M6 and M4.** Ranked 1 and 2 on buyer care, ranked 9= and 8
on likelihood of winning. The axes that decide purchases are the axes this
project currently fails, and the failures are not subtle: there is no evaluation
path at all, and the false-alarm rate has never been measured while one false
alarm is demonstrated.

**The one place they agree: M2.** High buyer care (3rd) and high likelihood of
winning (3rd for M2b, 5th for M2a). It is the only metric in the set where "we
would probably win" and "a buyer would probably care" are both true, and it is
the only one that follows directly from the architecture rather than from a
capability that could be bolted onto a competitor. M7 is its supporting evidence
— a group is only worth collapsing if the entry at the top of it is the real
cause.

**If only one thing gets measured, measure M2 with M7 as its control.** If two,
add M5, because it is nearly free, the harness already exists unrun, and the
repository has already written down what a bad result would refute — which makes
it the only metric here that can produce a finding rather than a score.

---

**Sources.** [`comparison.md`](comparison.md) ·
[`flakiness.md`](flakiness.md) ·
[`docs/specs/`](specs/README.md) — 0002 (history store), 0003 (CLI), 0006
(Storybook adapter), 0007 (Linux verification) ·
journal [0010](context/journal/0010-pixel-arm.md),
[0011](context/journal/0011-refuted-and-corrected.md),
[0012](context/journal/0012-instability.md),
[0013](context/journal/0013-observability.md)

**Code this document points at.** `packages/core/src/judge/docket.ts` ·
`packages/core/src/attribute/source.ts` · `packages/core/src/judge/verdict.ts` ·
`packages/cli/src/commands/run.ts` · `examples/todomvc/src/mutations.ts` ·
`examples/todomvc/src/code-mutation.ts` ·
`examples/todomvc/src/observe.chromium.test.ts` ·
`examples/todomvc/src/pixel.chromium.test.ts` ·
`examples/kitchen-sink/src/corpus.ts` · `docker/linux-verify.sh`

**Vendor pages read 2026-08-02.**
[Percy pricing](https://www.browserstack.com/pricing?product=percy) ·
[Percy RCA](https://www.browserstack.com/docs/percy/root-cause-analysis/overview) ·
[Chromatic pricing](https://www.chromatic.com/pricing/) ·
[Chromatic billing](https://www.chromatic.com/docs/billing/) ·
[Argos pricing](https://argos-ci.com/pricing) ·
[Argos diff engine](https://github.com/argos-ci/argos/blob/main/apps/backend/src/screenshot-diff/diff/image/index.ts) ·
[Applitools pricing](https://applitools.com/pricing/) ·
[Applitools ToS](https://applitools.com/terms-of-use/) ·
[Applitools test maintenance](https://applitools.com/docs/eyes/concepts/reviewing-tests/test-maintenance)
