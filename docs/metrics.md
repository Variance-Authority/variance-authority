# Metrics

These measurements decide whether attribution and tiered observation improve a
visual-regression workflow. Each metric names its unit, denominator, and evidence
boundary so a small self-authored corpus cannot masquerade as product maturity.

[`comparison.md`](comparison.md) owns the vendor feature comparison.
[`instruments.md`](instruments.md) maps product claims to the tests and artifacts
that measure them.

## Measurement rules

1. Declare the corpus and strata before observing the result.
2. Keep self-authored, harvested, and synthetic evidence separate.
3. Count confident wrong answers separately from absent answers.
4. Report an unobservable value as absent, never zero.
5. Record renderer identity, viewport, engine, and source revision with every
   pixel measurement.
6. Treat a result fitted against its own corpus as regression evidence, not an
   estimate of general accuracy.

The core strata are component stories, composed/page stories, route-level
subjects, and non-React subjects. A headline rate without those strata hides
where component/source attribution is available and where it is structurally
absent.

## M1. File attribution

**Question:** does the top-ranked changed region name a repository file that
contains the responsible edit?

**Unit:** one changed subject.

**Result classes:**

| Result | Meaning |
| --- | --- |
| `named-correct` | The top-ranked file belongs to the declared changed-file set |
| `named-wrong` | A file is named but is outside that set |
| `not-named` | The observation offers no file |

Report top-1 precision as the primary result and top-3 recall separately. A long
list containing the answer is not equivalent to attribution.

The repository's kitchen-sink corpus is self-authored. Its agreement tests guard
the implementation against regression; they do not estimate accuracy on an
independent codebase.

## M2. Review compression

**Question:** how many review items remain after changed pixels are grouped by
cause?

**Unit:** one intentional edit reaching one or more subjects.

Report:

- changed subjects;
- isolated pixel regions;
- component causes;
- collateral regions;
- docket roots presented for review.

Compression is useful only when grouping precision remains explicit. One
incorrect root is worse than several honest items, so false merges and false
splits are reported separately.

## M3. CI machine cost

**Question:** what does each observation tier cost on the adopter's machine?

**Unit:** wall-clock machine-seconds for one run, split by acquisition, semantic
decision, rendering, comparison, and reporting.

Report cold and warm runs separately. Include browser launch, resource closure,
remote transport, and cache hits. In-place and deferred rendering are separate
rows: in-place avoids reconstruction but takes repeated screenshots; deferred
rendering pays archive/paint cost and can reuse content-addressed rasters.

The measurements in source tests are local benchmark evidence. They establish
relative behavior on that fixture and machine, not a universal throughput
promise.

## M4. False verdicts

### M4a. False alarms

**Question:** does an unchanged product report `changed` because the rendering
environment moved?

Synthetic cases vary one input at a time: text rasterization, scale, browser
engine, font declaration, scrollbar behavior, and capture order. A correctly
partitioned environment produces `incomparable` or a classified instability,
not a component regression.

### M4b. False misses

**Question:** does an intentional visual change settle as `unchanged`?

The corpus includes structure, paint, geometry, content, canvas/media, and
resource-only changes. Report scorable, unobservable, and contested cases
separately. DOM-only acquisition is expected to leave canvas/media pixels
unobservable; that boundary is not scored as a pass.

## M5. Cross-machine comparability

**Question:** do two machines either produce byte-identical rasters or refuse to
compare under different renderer identities?

**Unit:** one resource-closed document rendered under two declared environments.

Compare:

- image dimensions and bytes;
- engine/platform/scale/font/stabilization/rasterization identity;
- verdict when identity differs;
- remote versus in-process rendering of the same closed document.

An environment-dependent document is excluded from this metric because the two
renderers may legitimately fetch different bytes.

## M6. Time-to-first-verdict on a cold repository

**Question:** how much adopter work stands between installation and the first
correct verdict?

**Procedure:** start from a clean repository whose operator has read only the
public docs. Measure through one real change and its baseline workflow.

**Report:**

| Measure | Why it matters |
| --- | --- |
| Wall-clock minutes | Evaluation friction |
| Files added or edited | Integration weight |
| Operator-authored lines | Configuration versus implementation |
| Browser/service prerequisites | Infrastructure burden |
| External accounts | Procurement burden |

Run the Storybook, route, Playwright, and unit-capture offerings separately.
Do not substitute a package's internal fixture for the adopter path.

## M7. Cause/collateral ranking

**Question:** is the component containing the intentional edit ranked before
components that merely reflowed or repainted around it?

**Unit:** one changed subject with a declared responsible component.

Report top-1 cause accuracy, collateral incorrectly promoted to cause, and
unattributed regions. Area is the null ranking model: a ranking must outperform
“largest region first” to demonstrate value.

## M8. Accumulated drift

**Question:** can a sequence of individually approved changes reveal a cumulative
token movement?

**Unit:** one token/component pair across approved revisions.

Report per-revision values, cumulative delta, approval count, and the first
revision where the declared drift policy fires. A history store that cannot
answer is absent evidence, not zero drift.

## M9. Blind spots

**Question:** what can the chosen composition not observe?

Inventory by material and host:

| Composition | Structural blind spot |
| --- | --- |
| Browserless document capture | canvas, WebGL, video, browser layout before later rendering |
| Environment-dependent document | resource bytes unavailable to another renderer |
| Raster without snapshot | component, band, exclusion, and source attribution |
| In-place browser raster | launch identity is a caller declaration |
| DOM provenance | framework/runtime ownership not supplied by the host |

This metric is not ranked to be won. It is complete when every unsupported
conclusion is visible at the decision boundary.

## What has been taken

The nine above are definitions. This is the standing of each one; two are
taken, six are partial, and one has no reading at all.

| | Standing | Where |
| --- | --- | --- |
| M1 | **partial** — one incumbent, eight scenarios, no strata | [`cases/incumbent-case`](../cases/incumbent-case) — 6 hit, 1 false alarm, 1 deferral against the incumbent's 3 hit, 3 miss. Top-1 against a declared changed-file set on an independent corpus is not taken |
| M2 | **partial** — the root count is asserted, the review saving is not | `examples/kitchen-sink/src/measure.test.tsx` — 18 scorable cases, each declared in advance to present exactly **one docket root**, so a false merge and a false split both fail. What is not reported is the compression: nothing counts the changed subjects and isolated regions those 18 roots stand in for |
| M3 | **partial** — two ratios, no per-tier split | `examples/kitchen-sink` bench (warm against cold capture) and `packages/dom/src/style-index.test.ts` (shared index against per-subject). Acquisition, decision, render, compare and report are not separately timed on any run |
| M4a | **partial** — synthetic, one machine | `packages/playwright/src/engines.chromium.test.ts` partitions by engine; the pixel arm reports a strict-policy noise floor of 91 px on unchanged stories. Scale, font declaration and capture order are handled by the identity rather than measured against it |
| M4b | **taken** | `examples/todomvc`'s pixel arm — three blind-spot probes, of which the canvas repaint is a scored miss and the other two are caught. Unobservable is reported as unobservable, not as a pass |
| M5 | **partial** — two processes, one machine | `examples/todomvc/src/offload.chromium.test.tsx` — the same closed document paints identically in-process and across a socket. Two machines have never been compared |
| M6 | **partial** — integration weight only | Four offerings in [`cases/`](../cases): Storybook is 2 new files and ~24 operator lines, unit capture 1 new file and ~17, additive Playwright 0 new files and ~18 lines inside an existing spec. Wall-clock to first verdict from a clean repository is not measured for any of them |
| M7 | **partial** — the blame is asserted, the null model is not | `examples/kitchen-sink/src/measure.test.tsx` — the same 18 cases each declare **which component** the report must blame, which is what caught a `prop` root attributing to the component the pixels moved in rather than the one that passed the prop. Nothing compares the ranking against "largest region first", which is the null model this metric exists to beat |
| M8 | **not taken** | Every part is built and tested; no sequence of approved changes has been observed end to end ([`history.md`](history.md)) |
| M9 | **taken, and never finished** | [`gates.md`](gates.md), the table in M9 above, and the pixel arm's blind-spot probes. This is the metric that is complete only while it is being maintained |

**One machine, one Chromium, one corpus written by the implementers.** That
bound sits under every row above and is not repeated in each of them; see
[`instruments.md`](instruments.md#what-none-of-this-establishes).

## Reading the set

No single score represents the product. M1, M2, and M7 measure reviewer signal;
M3 and M6 measure adoption/operation cost; M4 and M5 measure correctness; M8
measures longitudinal value; M9 prevents the other numbers from claiming more
than their evidence.

The useful result is a table with all denominators and strata present. A missing
metric remains missing; it does not inherit the result of the nearest proxy.
