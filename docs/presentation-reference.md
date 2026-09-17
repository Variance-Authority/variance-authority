# Presentation evidence reference

Presentation evidence describes how information is grouped, separated, aligned,
repeated, surfaced, and emphasized in one rendered interface. It gives a person
or coding agent measurements they can inspect and challenge. It never supplies a
global score, a preferred density, or a design verdict.

For the live before-and-after workflow, start with
[Inspect presentation relationships during a UI edit](presentation.md). The
[`@variance-authority/presentation` package reference](../packages/presentation/README.md)
owns installation and complete TypeScript signatures; this page owns the
meaning, presence rules, and selection boundaries of the evidence they return.

## Choose an entry point

| Starting point | Use | What it answers |
|---|---|---|
| Live Playwright `Page` and subject `Locator` | `sensePresentation` from `@variance-authority/presentation/playwright` | Acquires browser layout and Playwright ARIA evidence, then returns one presentation report. |
| Existing `RawCapture` | `analyzePresentation` from `@variance-authority/presentation` | Derives the same report without browser or filesystem access; browser accessibility evidence is optional. |
| Existing report and one structural owner | `focusPresentation` | Returns evidence owned at that level without re-sensing the page. |
| Product-known peers across wrappers | `inspectPresentationAlignment` | Measures their selected alignment coordinate, spread, and member deviations. |
| Consecutive regions arranged by one owner | `inspectPresentationSpacing` | Measures every adjacent gap, boundary strength, and spacing cluster in the run. |
| Product-known spacing roles | `inspectPresentationHierarchy` | Evaluates declared outside-in roles and reports where adjacent meanings are not distinguishable. |
| Two reports | `comparePresentation` | Compares finding counts and information identity as separate dimensions. |
| Two reports whose consequence must survive the browser session | `presentationSignal` | Produces introduced, resolved, or measurement-changing persisted effects for a general run report. |

Choose the narrowest reading that matches the product question. A broader
reading does not make the evidence more authoritative; it can instead flatten
correctly nested relationships into apparent peers.

## Sense one subject

`sensePresentation(page, locator, options)` reads a locator in an existing
Playwright page. The locator defines the semantic and geometric boundary. Capture
root `0` is that locator; later roots are React portal content in capture order.

The available options are:

| Option | Meaning |
|---|---|
| `subjectId` | Stable identity for the sensed boundary. Defaults to `presentation`. |
| `title` | Optional human-facing title for the subject. |
| `fonts` | Font identities established by the caller. They affect the report digest, not content identity. |
| `suspense.timeoutMs` | Settlement bound for React Suspense before sensing. |
| `stabilize` | Replaces the default stabilization recipe by intervention id. `[]` is only for a caller-owned static document whose page clock cannot advance. |
| `paint` | `true` paints every diagnostic layer; a layer list paints only those layers; omission leaves the page unpainted. |

Readiness follows the chosen subject. Images inside the locator and its portals
settle before geometry is read, while an unrelated incomplete image elsewhere in
the document does not hold the reading open. Font settlement remains
document-wide because substitution can move geometry inside the subject.
Presentation sensing does not collect React source provenance because the report
does not consume it.

The default recipe belongs on live pages. Passing `stabilize: []` is not a faster
mode; it is a declaration that the document is static and has no page clock that
needs settling.

## Read a report

One `PresentationReport` keeps independent kinds of evidence together without
collapsing them into a score.

| Field | Meaning | Presence rule |
|---|---|---|
| `semantic.anchors` | DOM-correlated roles and accessible names attached to element references. | Empty means anchoring ran and found none. |
| `semantic.browserAccessibility` | The Playwright ARIA snapshot observed beside the capture. | Absent means browser ARIA was not observed. Empty or partial roots remain present. |
| `telemetry` | Content counts and, when layout exists, dimensions, utilization, occupied area, and density. | Content telemetry remains available without layout. Layout-derived telemetry is absent without layout. |
| `graph` | Rendered nodes and their containment, separation, alignment, baseline, and peer relations. | Without layout, `nodes` and `relations` are empty. |
| `spacing`, `axes`, `baselines`, `prominence`, `surfaces`, `patterns` | Structures derived from measured layout. | Absent when the capture profile cannot observe layout. |
| `findings` | Named relationship failures with their owner, involved nodes, and measurements. | Absent means layout was unobserved. Empty means layout was measured and no rule fired. |
| `paint` | Located instructions for diagnostic overlays. | Absent without layout. |

A layout-capable capture must carry a rectangle for every rendered element. A
missing rectangle is refused by element path rather than treated as an empty
box.

### Graph identity and relations

A graph node is a rendered element with a stable boundary-relative id, semantic
class, geometry, typography, surface evidence, state signature, and relative
prominence. Text nodes occupy path positions but are not invented as rendered
objects.

Relations retain containment, measured sibling separation, discovered
alignment, inferred text baselines, and semantic peers. Baselines are labelled
`inferred`: browser geometry and typographic approximation are not presented as
optical alignment.

Repeated sibling shapes form local peer groups. Each group records recurring
labels, a dominant presentation signature, similarity, and outliers. Observed
state such as `invalid`, `selected`, or `disabled` may explain an outlier; the
variance remains measurable but is not reported as unexplained drift.

Telemetry describes the setting in which those relationships occur. A tall
page, dense viewport, large margin, narrow region, or unused area cannot create
a finding by itself.

## Choose a reading

The acquisition boundary answers what was read. Structural ownership answers
which elements may be interpreted together.

### Focus one owner

`focusPresentation(report, ownerId)` defaults to `depth: 'owner'`. It returns the
owner, its immediate children, patterns and findings owned at that level, and
paint for the same evidence. Deeper evidence stays separate in the `nested`
counts.

Use `depth: 'subtree'` only when the product question deliberately treats the
complete composition as one reading. It folds descendant owners into the result;
it is not a convenience for “show everything.” A requested finding id must
belong to the selected owner and depth.

### Inspect an alignment across wrappers

`inspectPresentationAlignment(report, ownerId, memberIds, kind)` is for a visual
flow the product knows about even when implementation wrappers separate its
members. It requires at least two distinct nodes inside one owner and returns the
selected coordinate, overall spread, and each member's deviation.

Member selection is the caller's product claim. Shared ancestry or a matching
role does not authorize flattening both a wrapper and its nested control into
the same peer set. The reading remains measurement and never creates a finding
or an acceptability threshold.

### Inspect spacing at one composition

`inspectPresentationSpacing(report, ownerId, memberIds, axis)` reads consecutive
immediate children in structural order. The members may be heterogeneous: a
heading region, summary, action area, and activity region can still form one
composition whose adjacent gaps matter together.

The result retains every distance, boundary strength, and spacing cluster plus
min/median/max summaries. Descendants, skipped siblings, or an axis that does
not describe the owned separations are refused. The sequence remains the useful
evidence; its maximum or median alone can conceal one abrupt boundary.

### Declare product-known relationship roles

`inspectPresentationHierarchy(report, contract)` evaluates a caller-declared
owner, axis, and at least two relationship levels. Roles are ordered outside-in:

1. `owner-boundary`
2. `leading-to-body`
3. `body-peer`
4. `content-internal`

The contract refuses unknown nodes, relationships outside the owner, missing
measured separations, duplicate or reversed roles, and a pair reused under two
roles. Adjacent roles that occupy the same spacing cluster or calibrated local
distribution produce `SPACING_HIERARCHY_COLLISION` evidence.

Only product meaning can name these roles. A design-system token explains an
implementation value; it cannot establish whether that value separates an
owner from its content, a label from a body, or two body peers.

## Finding rules

The rule set names measured relationship failures and nothing else.

| Rule | Measured condition |
|---|---|
| `SEPARATION_COLLISION` | Between-object boundary strength is indistinguishable from within-object boundaries. |
| `SPACING_RELATION_COLLISION` | Different relationship classes occupy the same inferred spacing cluster or distribution. |
| `SPACING_HIERARCHY_COLLISION` | Adjacent product-declared hierarchy roles occupy the same spacing cluster or calibrated distribution. |
| `ALIGNMENT_OUTLIER` | One corresponding peer departs from a dominant alignment axis. |
| `BASELINE_DRIFT` | One corresponding text-bearing peer departs from an inferred baseline. |
| `PROMINENCE_COLLAPSE` | A heading class and ordinary text class occupy the same prominence treatment. |
| `SURFACE_COLLISION` | A meaningful painted surface has low perceptual difference from its container and no border or shadow contribution. |
| `REPETITION_GRAMMAR_COLLAPSE` | Repeated objects have weak between-instance boundary evidence. |
| `PRESENTATION_GRAMMAR_DRIFT` | A peer departs from a dominant signature without observed semantic state explaining it. |

Every finding carries a stable report-local id, the graph node that owns the
relationship, the involved nodes, and its measurements. Pattern- and
contract-based findings carry those correlation ids as well.

Thresholds calibrate when measured evidence supports a rule. They are pinned by
firing and non-firing cases and are not exposed as preferred margins, density,
page dimensions, or spacing values.

## Paint evidence without re-sensing

Paint instructions come from the same report as the measurements. Painting a
focus, alignment, spacing run, or hierarchy reading therefore does not acquire
the page again.

The available layers are `semantic`, `spacing`, `axes`, `baselines`, `surfaces`,
`prominence`, `repetition`, and `findings`. Each instruction carries its owner
and touched nodes; finding, pattern, and hierarchy paint also carries the
corresponding report-local id.

The overlay is a non-interactive SVG. It takes no pointer events, exposes
nothing to assistive technology, and does not change the application's styles.
Its conspicuous colors identify diagnostic groups, not judgments about the
product's colors. A later acquisition removes an earlier overlay before reading
the page, and `clearPresentationPaint(page)` removes it explicitly.

## Compare two readings

`comparePresentation(before, after)` returns finding counts per rule and an
independent information comparison:

- presentation-independent content identity;
- element count;
- character count; and
- repeated-object count.

Content identity covers structure, text, DOM-correlated semantics, state, and
browser ARIA evidence before layout analysis. Equal counts cannot conceal
substituted information; `information.content.preserved` is true only when the
identity holds.

Comparison is edit feedback, not a retained baseline or approval lifecycle. A
decrease in findings does not mean improvement when required information also
disappeared, and a density change is neither success nor failure.

### Carry the consequence into a run report

`presentationSignal(before, after, options)` is the smaller durable projection
for `ObservationRecord.signals.presentation`. Automatic findings and optional
product-owned hierarchy readings become `introduced`, `resolved`, or
measurement-changing `persisted` effects. The signal also retains content
identity and information-count deltas.

Presence remains meaningful:

- A missing report, or a side without layout findings, produces
  `incomparable` with the missing side named and no effects.
- A present empty effects list means both sides were measured and no
  relationship consequence changed.
- An absent presentation signal means no producer measured that boundary.

Presentation consequence, renderer impact, and the visual-regression verdict
remain separate axes. Storing a signal applies no policy and never changes the
observation verdict.

## Authority and limits

The useful boundary is simple: preserve information and expose relationships.
The evidence may show that two declared meanings are rendered alike or that one
peer departs from its group. It cannot decide how much information the product
should contain or whether the response should be a table, cards, typography,
spacing, a denser layout, a sparser layout, or no edit.

ARIA evidence remains an independent browser reading, not a repaired version of
the DOM-correlated anchors. Empty and partial roots are observed values. Only
absence means they were not observed.

A clean report means no implemented rule fired on the evidence available. It is
not a certificate of accessibility, usability, visual quality, or product fit.
