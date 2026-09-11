# How to judge the evidence

Variance Authority reads structure, component ownership and source provenance
alongside pixels. That evidence is meant to replace _an image moved_ with a
smaller decision: whether the change is real, what caused it, where it is
written, and which other changed regions share that cause.

More evidence is not automatically a better visual-regression workflow. It is
better only when three things hold together:

- verdicts remain correct, including when the environment changes or a chosen
  capture surface cannot observe part of the subject;
- attribution reduces the review decision without merging unrelated changes or
  promoting collateral movement as the cause; and
- machine, adoption and operational costs are reported beside the reviewer
  benefit rather than inferred from one fast inner operation.

History adds a fourth question: whether evidence retained across approved
revisions reveals cumulative drift. Every conclusion is bounded by what the
chosen capture and host can observe.

This page defines the measurements required to make those claims. It specifies
the unit, denominator and evidence boundary of each number so that a strong
result on one fixture cannot stand in for a usable workflow. The readings behind
current product claims are in [Evidence instruments](instruments.md);
[replacement gates](gates.md) turn those readings into an adoption decision, and
[product comparison](comparison.md) covers capability and ownership differences.

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
promise.

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
not substitute a package's internal fixture for the adopter path.

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
conclusion is visible at the decision boundary.

## Drawing a conclusion

A reading states its corpus, host, observation profile, sample size,
denominator, strata and comparison method. Its conclusion applies to those
conditions; another corpus or host requires another reading.

An attribution result needs M1 and M7 beside the false-verdict accounting in M4.
A claim of workflow improvement combines that correctness and reviewer signal
with M2, M3 and M6; otherwise the result says only that one part works.
Cross-machine operation needs M5. Longitudinal value needs M8. M9 bounds every
one of those conclusions.

The outcome is therefore a set of measurements, not a product score. Missing
metrics remain missing, and a result on the nearest proxy does not fill them.
Use [Evidence instruments](instruments.md#where-each-claim-is-measured) for the
readings the repository can substantiate and [replacement gates](gates.md) for
the decision those readings support.
