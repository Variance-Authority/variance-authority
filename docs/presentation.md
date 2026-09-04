# Presentation intelligence

Presentation intelligence is a sensing and support surface for a coding agent.
It describes how required information is grouped, separated, aligned, repeated,
and emphasized in one live interface. It does not decide how much information
the product should contain or which visual strategy should present it.

The operating principle is: **preserve information; expose relationships**.

## One report, independent dimensions

[`sensePresentation`](../packages/presentation/README.md#sense-once-then-choose-the-structural-owner)
reads a locator in a live Playwright page. Its report keeps these dimensions
separate:

| Dimension | Evidence |
|---|---|
| Semantic context | DOM-correlated roles, accessible names, state, and the independent Playwright ARIA snapshot |
| Presentation graph | Element references and containment, separation, alignment, baseline, and peer relations |
| Telemetry | Content volume, dimensions, utilization, occupied area, and density |
| Derived structures | Spacing, alignment, baseline, prominence, and surface clusters; repeated patterns and dominant signatures |
| Findings | Measured relationship collapse or unexplained peer drift |
| Paint | Rectangles, axes, baselines, gaps, patterns, surfaces, prominence clusters, and finding locations |

Telemetry is context. A tall page, dense viewport, narrow region, large margin,
or unused horizontal area cannot create a finding independently. Those values
may help an agent interpret a measured relationship failure, but the failure
names the relationship rather than a preferred density or layout.

The acquisition boundary also governs default image settlement. Images inside
the locator and its React portals settle before geometry is read; an unrelated
incomplete image elsewhere in the document does not hold the reading open. The
collector omits React provenance because no presentation report field consumes
it. Font settlement remains document-wide because it can change geometry inside
the boundary. A caller-owned static document whose page clock cannot advance can
replace the recipe with `stabilize: []`; live pages retain the default.

## Presentation graph

A graph node is a rendered element with a stable boundary-relative reference,
semantic class, geometry, typography, surface evidence, state signature, and
relative prominence. Root `0` is the inspected locator; later roots are React
portal content in capture order. Text nodes occupy path positions but are not
invented as rendered objects.

Relations retain containment, measured sibling separation, discovered alignment,
inferred text baselines, and semantic peers. Baselines remain labelled
`inferred`; browser geometry and a typographic approximation are not presented as
optical alignment.

Repeated sibling shapes form local peer groups. Each group carries recurring
labels, presentation similarity, a dominant signature, and outliers. A state
signature such as `invalid`, `selected`, or `disabled` explains visual variance;
the measurement remains in the report, but it is not called unexplained drift.

## Structural ownership

A broad locator is an acquisition boundary, not a claim that every descendant
is a peer. Each finding names the graph-node `owner` whose immediate structural
relationship produced it. `focusPresentation` reads that owner without another
browser acquisition and keeps findings from nested owners separate by default.
Its `nested` counts signal that deeper boxes contain evidence without folding
that evidence into the parent composition.

This supports three distinct readings from one report:

- A composition is read holistically to understand which boxes and flows it
  contains. Its content and illustration need not align merely because they
  share the composition.
- A box owns the relationships among its immediate contents. Repeated rows in a
  list, for example, are inspected at the list owner rather than at the page.
- A visual flow may cross implementation wrappers. A caller that knows the
  product relationship selects those nodes with `inspectPresentationAlignment`;
  the returned coordinate, spread, and member deviations remain evidence, not
  an automatic design verdict. The selection stays at one structural level: a
  matching role on a container and on its nested control does not make both
  peers. Its paint marks that exact peer selection and median axis without
  acquiring the page again.

`depth: 'subtree'` is an explicit request to fold nested ownership into a
holistic reading. It is not the default.

## Findings

The deterministic set remains deliberately small:

| Rule | Measured condition |
|---|---|
| `SEPARATION_COLLISION` | Between-object boundary strength is indistinguishable from within-object boundaries |
| `SPACING_RELATION_COLLISION` | Different relationship classes occupy the same inferred spacing cluster or distribution |
| `SPACING_HIERARCHY_COLLISION` | A leading structural label-to-body relation occupies the same spacing cluster or distribution as the body peer-to-peer relation it should distinguish |
| `ALIGNMENT_OUTLIER` | One corresponding peer departs from a dominant alignment axis |
| `BASELINE_DRIFT` | One corresponding text-bearing peer departs from an inferred baseline |
| `PROMINENCE_COLLAPSE` | A heading class and an ordinary text class occupy the same prominence treatment |
| `SURFACE_COLLISION` | A meaningful painted surface has low perceptual difference from its containing surface and no border or shadow contribution |
| `REPETITION_GRAMMAR_COLLAPSE` | Repeated objects have weak between-instance boundary evidence |
| `PRESENTATION_GRAMMAR_DRIFT` | A peer departs from a dominant signature without observed semantic state explaining it |

Thresholds are implementation calibration, not design targets. They determine
when measured peer evidence supports one of the named relationship findings;
they never define a preferred density, margin, page dimension, or spacing scale.

Product-known relationships can be declared after sensing with
`inspectPresentationHierarchy`. Its typed roles run from `owner-boundary`
through `content-internal`; the API refuses reversed or duplicated roles,
relationships reused under two roles, missing separations and nodes outside the
declared owner. Adjacent roles sharing a spacing cluster or calibrated local
distribution become `SPACING_HIERARCHY_COLLISION` evidence. Design-system token
identity is neither a role nor an exemption.

## ARIA is retained, not repaired

The Playwright ARIA snapshot is a separately sensitive input to the report. The
DOM-correlated anchors let graph nodes point back to rendered elements; the
browser snapshot retains what the engine exposed. Neither substitutes for the
other.

A snapshot exposing no ARIA nodes is an observed empty root. One with no parent
or no children, relative to the boundary, is an observed partial root. Both
remain present and participate in the report digest. Only the absence of browser
accessibility altogether means it was not observed.

## Paint the evidence

Pass `paint: true` to paint every diagnostic layer, or name the layers to show.
The page agent draws a non-interactive SVG over the document without changing the
application's styles. Every mark carries its layer and measurement id. A later
inspection removes an earlier overlay before reading the page, and
`clearPresentationPaint` removes it explicitly.

The colors are diagnostic identities, not an interpretation of the product's
colors. Surface groups, repeated patterns, and outliers are deliberately painted
with conspicuous colors so a human can challenge the analyzer's grouping.

Paint instructions carry their owner and touched nodes. Pattern and finding
instructions also carry the corresponding stable report-local id. A focused
reading can therefore paint one owner or one finding from an existing report;
an explicit alignment reading can paint its selected members and median axis.
Neither requires re-sensing the page.

## Re-sense and retain the consequence without owning the verdict

`comparePresentation` reports finding counts before and after beside a
presentation-independent content identity and element, character, and
repeated-object counts. The identity covers semantic classes, names, text,
state, and browser ARIA evidence before layout analysis, so equal counts cannot
hide substituted or deleted information even when layout is unobserved. It does
not claim improvement from a density change. The comparison is optional edit
feedback between two sensed reports. The offering owns no baseline, approval
lifecycle, regression verdict, or threshold that decides whether a build may
pass.

`presentationSignal` projects that before-and-after evidence into the general run
report. Automatic findings and supplied product-owned hierarchy readings become
introduced, resolved, or measurement-changing persisted effects under
`ObservationRecord.signals.presentation`. The signal also retains content
identity and information-count deltas. Missing reports or layout findings are
`incomparable`; a present empty effect list means both sides were measured and no
relationship consequence changed. The stored signal remains independent of the
renderer's layout, paint and composite impact, and never changes the observation
verdict.

The engine supplies objective evidence. The coding agent remains responsible for
product meaning and for choosing whether the appropriate response is a table,
cards, typography, spacing, a denser presentation, a less dense presentation, or
no change.
