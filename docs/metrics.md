# Metric definitions

This page specifies nine metrics — M1–M9 — for judging visual-regression
evidence, giving the unit, denominator and evidence boundary of each. **It
reports no readings.** The readings the repository can substantiate, with their
counts, timings and the test files that produce them, are in
[Evidence instruments](instruments.md#where-each-claim-is-measured);
[replacement gates](gates.md) turns those readings into an adoption decision,
and [product comparison](comparison.md) covers capability and ownership
differences.

**You do not need this page to review a run.** A run already presents its
verdict, causes and unresolved docket. Come here to publish a product claim, to
check whether a result transfers to another corpus, host or machine, or to
decide what to measure before adopting.

**If you are deciding whether to adopt, start with M6, M9 and M3.** M6 is the
time and integration work between a clean checkout and your first correct
verdict; M9 is the blind-spot inventory for the capture surface you pick; M3 is
the machine cost of a run on your own hardware. The other six need per-case
ground truth, a declared corpus, a second machine or a history of approvals —
[what you can run yourself](#what-you-can-run-yourself) gives the cost of each.

## What these metrics defend

[Variance Authority](README.md) reads structure, component ownership and source
[provenance](attribution.md) alongside pixels. That evidence is meant to replace
_an image moved_ with a smaller decision: whether the change is real, what
caused it, where it is written, and which other changed regions share that
cause.

More evidence is not automatically a better visual-regression workflow. It is
better only when three things hold together:

- verdicts remain correct, including when the environment changes or a chosen
  capture surface cannot observe part of the subject;
- [attribution](attribution.md) reduces the review decision without merging unrelated changes or
  promoting collateral movement as the cause; and
- machine, adoption and operational costs are reported beside the reviewer
  benefit rather than inferred from one fast inner operation.

History adds a fourth question: whether evidence retained across approved
revisions reveals cumulative drift. Every conclusion is bounded by what the
chosen capture and host can observe.

Each metric below specifies the unit, denominator and evidence boundary of one
number, so that a strong result on one fixture cannot stand in for a usable
workflow.

## Terms this page uses

- **docket root** — one cause a run leaves for a person or system to decide,
  such as a component or a token, rather than one changed pixel region
  ([information exchange](information.md)).
- **resource-closed document** — a captured document carrying the bytes it
  references, so a second renderer needs no access to the origin; an
  environment-dependent document instead requires that renderer to reach
  equivalent resources through a preserved base URL
  ([choose from the state you already have](cases.md)).
- **composition** — the combination a setup selects across four independent
  choices: which process reaches the state, what crosses the acquisition
  boundary, where pixels are made, and where the answer is retained
  ([compose an observation](compose-observation.md)). The composition sets the
  evidence boundary, which is what M9 inventories.

## What you can run yourself

M6, M9 and M3 need only your own repository. The rest need ground truth or
hardware declared outside the tool, and the right column states what the
repository publishes for each today.

| Metric | Runnable on your repository | What it costs you | Reading published |
| --- | --- | --- | --- |
| M1 Changed-file hit rate | No | A per-case declaration of which files your edit touched, for every changed subject | Partial — `cases/incumbent-case` scores file-and-cause naming over eight cases |
| M2 Review compression | No | One declared intentional edit per case, plus a hand-scored judgement of each merge and split | None |
| M3 CI machine cost | **Yes** | One cold and one warm run of your own suite, per observation tier you are considering | Partial — component-level timings on the maintainers' fixtures, not a phase-split run cost |
| M4a False alarms | No | Synthetic cases that vary one environment input at a time | None |
| M4b False misses | No | A corpus whose cases are declared changed or unchanged before they run | None |
| M5 Cross-machine comparability | No, unless you have a second declared machine | Two machines and one resource-closed document | None — every timing and instability probe in the repository comes from one machine and one Chromium |
| M6 Time-to-first-verdict | **Yes** | A clean checkout, the public docs and a stopwatch, repeated per offering you are considering | None |
| M7 Cause and collateral ranking | No | A declared responsible component per case | Partial — the same `cases/incumbent-case` scoring |
| M8 Accumulated drift | No | A configured history endpoint and a sequence of approved revisions | None |
| M9 Blind spots | **Yes, by reading** | Nothing: read the M9 table against the composition you chose | The M9 table is the reading |

M9 is a compatibility matrix rather than a measurement, which is why it is the
one metric you can settle without running anything.

## Who produces a measurement

M1–M9 are evaluation metrics, not fields emitted by `variance run`. Variance
Authority produces one side of the evidence: observations, verdicts, attributed
regions, grouped causes, renderer identities and, when configured, history rows.
The other side — the known edit or unchanged state, the responsible file or
component, the comparison environment, and the work required to adopt the tool —
is declared by whoever runs the evaluation.

That separation is necessary. A tool cannot measure its own attribution accuracy
from the file it chose to name, or its own false-miss rate from the changes it
failed to observe. Those questions require ground truth declared independently
of the result.

| Metric | What Variance Authority supplies | Who completes the measurement |
| --- | --- | --- |
| M1 | Ranked changed regions and source locations | A test or case author compares them with a declared changed-file or responsible-file set |
| M2 | Changed subjects, regions, component causes, collateral and docket roots | A test or case author declares one intentional edit and scores false merges and splits |
| M3 | The acquisition and comparison workflow being timed | A benchmark runner records phase and total machine time under a named environment |
| M4 | A verdict and the dimensions the selected profile could observe | A corpus author declares unchanged and intentionally changed cases before running them |
| M5 | A resource-closed document, renderer identity and comparison refusal | Whoever owns both declared machines renders it on each and compares the results |
| M6 | The documented installation and baseline workflow | An adopter starts from a clean repository and records the human and machine cost |
| M7 | Regions ranked as causes or collateral | A corpus author declares the responsible component and scores the ordering |
| M8 | Observations and approvals written by configured runs | The history calculation applies a declared drift policy to those retained rows |
| M9 | The capabilities declared by the selected capture surface and observation profile | The integration author inventories the conclusions outside that evidence boundary |

A maintainer publishing a product claim and an adopter testing that claim on
their own repository need the same definitions and produce different subsets of
them; the split is in [what you can run yourself](#what-you-can-run-yourself). A
test, case or benchmark can automate the calculation only when it carries the
independent ground truth the metric requires.

## What the measurements decide

| Decision | What the evidence must establish | Metrics |
| --- | --- | --- |
| Can the verdict be trusted? | Intentional product changes are not missed, environment changes are not called product changes, and unavailable evidence remains visible | M4, M5, M9 |
| Does the explanation reduce review? | A declared changed file and the responsible component rank ahead of collateral movement, and one cause can cover several regions without false grouping | M1, M2, M7 |
| Is the evidence affordable to obtain? | Machine cost, integration work and external prerequisites are counted together rather than inferred from one fast operation | M3, M6 |
| Does retained evidence add value over time? | Individually accepted changes can still reveal cumulative movement | M8 |

No row substitutes for another. Accurate attribution does not excuse a false
`unchanged`; fast comparison does not establish low adoption cost; review
compression is not useful when it merges unrelated causes. M9 limits every
other result by naming what its composition could not observe.

## Rules for a valid reading

1. Declare the corpus and strata before observing the result.
2. Keep self-authored, harvested and synthetic evidence separate.
3. Count confident wrong answers separately from absent answers.
4. Report an unobservable value as absent, never zero.
5. Record renderer identity, viewport, engine and source revision with every
   pixel measurement.
6. Treat a result fitted against its own corpus as regression evidence, not an
   estimate of general accuracy.

Rules 1, 2 and 6 bind whoever publishes a rate. Rules 3, 4 and 5 bind any
reading, including one you take on your own repository.

The core strata are component stories, composed page stories, route-level
subjects and non-React subjects. A headline rate without those strata hides
where component and source attribution is available and where it is
structurally absent.

## M1. Changed-file hit rate

**Question:** does the top-ranked changed region name a file in the declared
changed-file set?

**Unit:** one changed subject.

| Result | Meaning |
| --- | --- |
| `named-correct` | The top-ranked file belongs to the declared changed-file set |
| `named-wrong` | A file is named but is outside that set |
| `not-named` | The observation offers no file |

Report the top-1 hit rate and the fraction of subjects with a hit among the top
three files separately. Membership in the changed-file set does not establish
causal correctness: with several edited files, an unrelated edit can count as a
hit. Measuring responsible-file attribution requires a per-case set of files
whose edits caused the observed change.

The repository's kitchen-sink corpus is self-authored. Its agreement tests guard
the implementation against regression; they do not estimate accuracy on an
independent codebase.

## M2. Review compression

**Question:** how many review items remain after changed pixels are grouped by
cause?

**Unit:** one intentional edit reaching one or more subjects.

Report changed subjects, isolated pixel regions, component causes, collateral
regions and docket roots presented for review. Report false merges and false
splits beside that compression: one incorrect root is worse than several honest
review items.

## M3. CI machine cost

**Question:** what does each observation tier cost on the adopter's machine?

**Unit:** wall-clock machine-seconds for one run, split by acquisition, semantic
decision, rendering, comparison and reporting.

Report cold and warm runs separately. Include browser launch, resource closure,
remote transport and cache hits. In-place and deferred rendering are separate
rows: in-place avoids reconstruction but takes repeated screenshots; deferred
rendering pays to archive and paint, and can reuse content-addressed rasters.

The measurements in source tests are local benchmark evidence. They establish
relative behavior on that fixture and machine, not a universal throughput
promise. Run this on your own suite and hardware; that is the number that
transfers.

## M4. False verdicts

### M4a. False alarms

**Question:** does an unchanged product report `changed` because the rendering
environment moved?

Synthetic cases vary one input at a time: text rasterization, scale, browser
engine, font declaration, scrollbar behavior and capture order. A correctly
partitioned environment produces `incomparable` or a classified instability,
not a component regression.

### M4b. False misses

**Question:** does an intentional visual change settle as `unchanged`?

The corpus includes structure, paint, geometry, content, canvas and media, and
resource-only changes. Report scorable, unobservable and contested cases
separately. DOM-only acquisition leaves canvas and media pixels unobservable;
that boundary is not scored as a pass.

## M5. Cross-machine comparability

**Question:** do two machines either produce byte-identical rasters or refuse to
compare under different renderer identities?

**Unit:** one resource-closed document rendered under two declared environments.

Compare image dimensions and bytes; engine, platform, scale, font,
stabilization and rasterization identity; the verdict when identity differs;
and remote versus in-process rendering of the same closed document.

An environment-dependent document is excluded because the two renderers may
legitimately fetch different bytes.

## M6. Time-to-first-verdict on a cold repository

**Question:** how much adopter work stands between installation and the first
correct verdict?

**Procedure:** start from a clean repository whose operator has read only the
public docs. Measure through one real change and its baseline workflow.

| Measure | Why it matters |
| --- | --- |
| Wall-clock minutes | Evaluation friction |
| Files added or edited | Integration weight |
| Operator-authored lines | Configuration versus implementation |
| Browser and service prerequisites | Infrastructure burden |
| External accounts | Procurement burden |

Run the Storybook, route, Playwright and unit-capture offerings separately. Do
not substitute a package's internal fixture for the adopter path. Each offering
has its own starting page: [Storybook](start-storybook.md),
[routes](start-routes.md), [Playwright](start-playwright.md) and
[unit capture](start-unit.md).

## M7. Cause and collateral ranking

**Question:** is the component containing the intentional edit ranked before
components that merely reflowed or repainted around it?

**Unit:** one changed subject with a declared responsible component.

Report top-1 cause accuracy, collateral incorrectly promoted to cause and
unattributed regions. Area is the null ranking model: a ranking must outperform
“largest region first” to demonstrate value.

## M8. Accumulated drift

**Question:** can a sequence of individually approved changes reveal cumulative
movement of a token in a component?

**Unit:** one token-and-component pair across approved revisions.

Report per-revision values, cumulative delta, approval count and the first
revision where the declared drift policy fires. A history store that cannot
answer is absent evidence, not zero drift.

## M9. Blind spots

**Question:** what can the chosen composition not observe?

| Composition | Structural blind spot |
| --- | --- |
| Browserless document capture | canvas, WebGL, video and browser layout before later rendering |
| Environment-dependent document | resource bytes unavailable to another renderer |
| Raster without snapshot | component, band, exclusion and source attribution |
| In-place browser raster | launch identity is a caller declaration |
| DOM provenance | framework and runtime ownership not supplied by the host |

This metric is not ranked to be won. It is complete when every unsupported
conclusion is visible at the decision boundary. Match the left column against
the composition your setup selects in [compose an observation](compose-observation.md).

## Drawing a conclusion

A reading states its corpus, host, observation profile, sample size,
denominator, strata and comparison method. Its conclusion applies to those
conditions; another corpus or host requires another reading.

An attribution result needs M1 and M7 beside the false-verdict accounting in M4.
A claim of workflow improvement combines that correctness and reviewer signal
with M2, M3 and M6; otherwise the result says only that one part works.
Cross-machine operation needs M5. Longitudinal value needs M8. M9 bounds every
one of those conclusions.

The outcome is therefore a set of measurements, not a product score. The right
column of [what you can run yourself](#what-you-can-run-yourself) states which
metrics the repository has readings for and which it does not; a result on the
nearest proxy does not fill the second group. Use
[Evidence instruments](instruments.md#where-each-claim-is-measured) for the
readings the repository can substantiate and [replacement gates](gates.md) for
the decision those readings support.
