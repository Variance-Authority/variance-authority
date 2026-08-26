---
name: variance-presentation
description: Sense, inspect, paint, and re-sense presentation relationships in a live Playwright page or Variance Authority RawCapture. Use for coding-agent UI presentation work; not for screenshot regression, baseline approval, generic accessibility auditing, or enforcing density and layout preferences.
---

# Variance Presentation

Use `@variance-authority/presentation` to make the presentation relationships in
one rendered subject observable while a coding agent investigates or changes the
interface. Keep presentation evidence, product information, and browser ARIA as
separate signals.

The offering senses and supports. It does not own a baseline, approve a visual
change, return a build verdict, score UI quality, or prescribe a redesign.

## Authority boundary

Preserve product meaning and expose rendered relationships.

- Treat content volume, density, dimensions, margins, whitespace, utilization,
  and page height as telemetry. None is independently a defect.
- Do not recommend deleting, hiding, collapsing, or truncating required
  information to reduce a finding.
- Do not infer a preferred table, card, accordion, column count, spacing scale,
  margin, density, or page length.
- Do not homogenize a visual difference when observed semantic state explains
  it.
- Do not infer implementation history from presentation variance.
- Findings name measured relationship failures. They are not severities,
  regressions, or design instructions.

If the request is only to inspect or explain, return evidence without editing
the application. If the request includes implementation, let the product task
and the user decide the response to that evidence.

## Choose the entry point

| Starting state | Entry point | Result |
|---|---|---|
| A live Playwright `Page` and subject `Locator` | `sensePresentation` from `@variance-authority/presentation/playwright` | Acquires browser layout and Playwright ARIA, analyzes them, and optionally paints the page |
| An existing `RawCapture` | `analyzePresentation` from `@variance-authority/presentation` | Pure report derivation; browser accessibility is optional independent evidence |
| One structural level in an existing report | `focusPresentation` from `@variance-authority/presentation` | Pure owner reading that keeps nested evidence separate by default |
| Product-known visual peers across wrappers | `inspectPresentationAlignment` from `@variance-authority/presentation` | Explicit coordinates, spread, and member deviations without a verdict |
| Two presentation reports | `comparePresentation` from `@variance-authority/presentation` | Optional edit feedback with finding counts and information identity kept separate |

Prefer a page the caller already owns. Launch a browser only when the user asks
for a new live or headed session.

## The first move: build the presentation hierarchy

The locator says what to acquire. It does not say that every descendant should
be compared. Before interpreting a finding or painting the page, map the sensed
subject into the smallest useful hierarchy:

| Structural reading | What belongs together | What does not follow |
|---|---|---|
| Composition | Major content, illustration, navigation, or action regions whose arrangement answers a whole-subject question | Descendants of different regions are not automatically peers |
| Box | Immediate contents whose boundary owns spacing, repetition, surface, or prominence evidence | A finding owned by a nested box is not a defect of every ancestor |
| Flow | Product-known visual peers, even when implementation wrappers separate them | Shared ancestry alone does not make a flow |
| Content or illustration | Material carried by a composition and the internal boxes that organize it | Content and illustration do not need alignment merely because they are adjacent |

Use the graph's containment, roles, names, text, geometry and repeated patterns
to make this map. Do not start by reading the findings list as prose about the
whole locator.

Then choose one path:

1. For a box-owned relationship, call `focusPresentation(report, ownerId)`.
   Read its immediate nodes and owned findings. If `nested` is non-zero, descend
   only when that nested box is the next product question.
2. For a deliberately holistic question, use `depth: 'subtree'` and state why
   descendants belong in the same reading.
3. For a visual flow that crosses wrappers, explicitly select its concrete
   nodes with `inspectPresentationAlignment`. The API measures the relationship;
   the product task authorizes the peer set.
4. Isolate one finding id before paint. Add a pattern or measurement layer only
   when it answers the same question.

After sensing, the report becomes a structural map, then one owned relationship,
then evidence for a product decision. A finding can legitimately produce no edit
when the hierarchy explains it.

## Sense a live subject

```ts
import type { Page } from '@playwright/test';
import { sensePresentation } from '@variance-authority/presentation/playwright';

declare const page: Page;

const report = await sensePresentation(page, page.getByRole('main'), {
  subjectId: 'underwriting:demands',
  title: 'Underwriting demands',
});
```

The locator is the semantic and geometric boundary. Root `0` is that locator;
later roots are React portal content in component-tree order. Prefer a stable,
meaningful boundary such as `main`, a named region, or the product surface named
by the task. Do not widen to the whole document merely to collect more nodes.

Options:

- `subjectId`: stable report identity for the boundary. It defaults to
  `presentation`.
- `title`: optional human-facing subject title.
- `fonts`: font identities the caller has independently established.
- `suspense.timeoutMs`: settlement bound for React Suspense before sensing.
- `paint`: omit for no overlay, use `true` for all layers, or provide selected
  layer names.

The browser agent waits for Suspense, applies the repository's collection
stabilization, collects computed style and layout, reads Playwright's ARIA
snapshot for the subject and portals, analyzes the plain capture, and then
optionally paints from the returned report. It does not capture a PNG. Prefer an
unpainted first acquisition so the hierarchy can decide which evidence to show.

If the page agent bundle is missing, build the installed package or repository
before retrying. Do not replace a missing bundle with an empty or improvised
page script.

## Work headed with a user

The same live entry point works with a headed Playwright browser:

```ts
import { chromium } from '@playwright/test';
import { focusPresentation } from '@variance-authority/presentation';
import {
  clearPresentationPaint,
  paintPresentationFocus,
  sensePresentation,
} from '@variance-authority/presentation/playwright';

const browser = await chromium.launch({ headless: false, slowMo: 50 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:3000');

const subject = page.getByRole('main');
const report = await sensePresentation(page, subject);
const finding = report.findings?.[0];
if (finding !== undefined) {
  const focus = focusPresentation(report, finding.owner, {
    findings: [finding.id],
    paint: ['findings'],
  });
  await paintPresentationFocus(page, focus);
}

await page.pause();
await clearPresentationPaint(page);
await browser.close();
```

Use headed operation when the user asks to see the evidence, challenge a
grouping, or work through an edit together. Explain which layers are visible and
connect any painted mark to its report measurement id.

Current collaboration boundaries:

- The package accepts an existing headed page; it does not own an interactive
  session, browser lifetime, layer picker, legend, or user annotations.
- The overlay has `pointer-events: none`, so it does not intercept interaction
  with the application.
- Paint is a reading at one moment, not a reactive inspector. After content or
  layout changes, call `sensePresentation` again. A new sense clears old paint
  before acquisition.
- `clearPresentationPaint(page)` removes only the diagnostic SVG.
- Collection stabilization is deliberately left in the document and can keep
  animations frozen. Clearing paint does not release it. Close or reload the
  page when the user needs the untouched animated state; do not claim the
  current API restores it.
- Keep a browser open only when the user asked for a headed session. A test or
  script ending still closes the page under its caller's lifecycle.

## Analyze an existing capture

```ts
import type { AccessibilitySnapshot, RawCapture } from '@variance-authority/core';
import { analyzePresentation } from '@variance-authority/presentation';

declare const capture: RawCapture;
declare const accessibility: AccessibilitySnapshot | undefined;

const report = analyzePresentation(capture, {
  ...(accessibility === undefined ? {} : { accessibility }),
});
```

The pure analyzer touches no live DOM. When `capture.profile.layout` is false,
it returns content identity, content telemetry, and semantic anchors while
layout-derived fields remain absent. If a profile claims layout but an element
rectangle is missing, analysis refuses the capture; an absent measurement is not
an empty box.

## Read the report

The report is deterministic JSON with these independent dimensions:

| Field | Meaning |
|---|---|
| `digest` | Identity of the entire presentation report, including retained browser ARIA when present |
| `contentDigest` | Layout-independent structure, text, DOM-correlated semantics, and state |
| `semantic.anchors` | DOM-correlated roles and accessible names attached to boundary-relative element references |
| `semantic.browserAccessibility` | Independent Playwright ARIA reading; absence alone means unobserved |
| `telemetry` | Neutral content, dimensions, utilization, occupied area, and density context |
| `graph.nodes` | Rendered elements with refs, semantics, state, rects, typography, surfaces, and relative prominence |
| `graph.relations` | Containment, separation, alignment, inferred-baseline, and semantic-peer relations |
| `spacing`, `axes`, `baselines`, `prominence`, `surfaces` | Derived measurable structures |
| `patterns` | Local repeated semantic shapes, recurring labels, dominant presentation signatures, and outliers |
| `findings` | Deterministic measured relationship failures |
| `paint` | Instructions used by the page overlay; absent when layout was unobserved |

For layout-derived fields, absence means layout was not observed. An empty array
means the dimension was measured and no entries were found. Never turn absence
into `[]` or zero.

Element references are stable within the boundary: `r0:0` is the subject,
`r0:0/2` is a descendant path, and `r1:0` begins the first portal root. Text
nodes occupy path positions but are not invented as rendered graph nodes.

Baselines are explicitly `inferred`. Treat them as browser geometry plus a
typographic approximation, not optical alignment.

Every finding carries a stable report-local `id` and an `owner`. Every paint
instruction carries an owner and touched nodes; finding and pattern paint also
carry their correlation ids. These fields are the route from a broad report to
one inspectable relationship.

## Focus one owner or visual flow

```ts
import {
  focusPresentation,
  inspectPresentationAlignment,
} from '@variance-authority/presentation';
import { paintPresentationFocus } from '@variance-authority/presentation/playwright';

const owner = report.patterns?.find((pattern) => pattern.instances.length >= 3)?.parent;
if (owner === undefined) throw new Error('no repeated owner was observed');

const owned = focusPresentation(report, owner, {
  paint: ['repetition', 'findings'],
});
const finding = owned.findings[0];
if (finding !== undefined) {
  const isolated = focusPresentation(report, owner, {
    findings: [finding.id],
    paint: ['findings'],
  });
  await paintPresentationFocus(page, isolated);
}

const navFlow = inspectPresentationAlignment(
  report,
  'r0:0',
  ['r0:0/0/0', 'r0:0/1/0', 'r0:0/1/1'],
  'vertical-center',
);
console.log(navFlow.spreadPx, navFlow.members);
```

`focusPresentation` refuses an unknown owner and refuses a requested finding
that is not owned at the selected depth. `inspectPresentationAlignment` refuses
fewer than two distinct members, unknown members and members outside the owner.
Its spread is neutral measurement, not a threshold or finding.

## Preserve ARIA as a separately sensitive signal

The DOM-correlated semantic anchors and Playwright's ARIA snapshot answer
different questions. Keep both.

- Omitting `accessibility` from pure analysis means browser ARIA was not
  observed.
- An observed root with no exposed ARIA is retained as an empty root, commonly
  `roots: ['']`.
- A boundary-relative root may expose no parent or no children. That is a
  partial reading, not malformed evidence.
- Empty and partial readings participate in the report digest without repair.
- Do not synthesize missing parents, children, roles, or names.
- Do not turn this presentation workflow into a generic accessibility audit.

ARIA state such as `invalid`, `selected`, or `disabled` may explain a peer's
visual variance. The report retains the variance and marks the explanation; it
does not call the difference unexplained grammar drift.

## Interpret findings

| Rule | Evidence required |
|---|---|
| `SEPARATION_COLLISION` | Between-object boundary strength is indistinguishable from within-object boundaries |
| `SPACING_RELATION_COLLISION` | Different relationship classes occupy the same inferred spacing cluster or distribution |
| `ALIGNMENT_OUTLIER` | One corresponding peer departs from a dominant alignment axis |
| `BASELINE_DRIFT` | One corresponding text-bearing peer departs from an inferred baseline |
| `PROMINENCE_COLLAPSE` | A heading class and an ordinary text class occupy the same prominence treatment |
| `SURFACE_COLLISION` | A meaningful painted surface has low perceptual difference from its container and no border or shadow contribution |
| `REPETITION_GRAMMAR_COLLAPSE` | Repeated objects have weak between-instance boundary evidence |
| `PRESENTATION_GRAMMAR_DRIFT` | A peer departs from a dominant signature without observed semantic state explaining it |

Read measurements before prose. Name the involved nodes, pattern, coordinates,
ratios, distances, clusters, or perceptual difference. Then connect that evidence
to the product task. Do not translate a finding into “looks wrong.”

Thresholds are analyzer calibration. They are not user-facing design targets.
A report with no findings is not a claim that the interface is good; it means no
implemented relationship rule fired on the observed evidence.

## Paint evidence

Available layers are:

- `semantic`: graph-node rectangles with semantic labels.
- `spacing`: separation lines with distance and spacing-cluster labels.
- `axes`: discovered alignment axes.
- `baselines`: inferred text baselines.
- `surfaces`: painted-surface groups.
- `prominence`: relative-prominence clusters.
- `repetition`: every instance of each repeated pattern.
- `findings`: affected nodes emphasized by rule.

Start with one owner and one finding. For a repeated
wall of text, use `repetition`, `spacing`, `prominence`, and `findings`. For one
misplaced action, use `axes`, `baselines`, and `findings`. Use `paint: true` only
when the full diagnostic field is useful rather than visually overwhelming.

Paint colors identify diagnostic groups. They do not judge or reinterpret the
application's product colors.

## Re-sense after an edit

```ts
import { comparePresentation } from '@variance-authority/presentation';

const feedback = comparePresentation(before, after);
```

Use comparison as optional edit feedback, not a stored baseline:

1. Sense the original subject and retain its report.
2. Make only the product-authorized edit.
3. Re-sense the same boundary under the same relevant environment.
4. Read finding deltas beside `information.content.preserved`, character count,
   element count, and repeated-object count.
5. Paint the measurements responsible for any claimed relationship change.

`information.content.preserved` covers presentation-independent structure,
text, DOM-correlated semantics, state, and browser ARIA. It is derived before
layout analysis, so it remains sensitive when layout is unobserved. A false value
does not automatically reject the edit: the product task may require content or
state to change. It prevents that movement from being hidden behind fewer
presentation findings.

Do not call fewer findings an improvement when required information disappeared.
Do not call unchanged density a failure. Do not call changed density a success.

## Report to the user

Lead with what was sensed and what relationship evidence is available. Keep
independent signals visibly separate:

- presentation findings and their measurements;
- neutral density, size, utilization, and content telemetry;
- DOM-correlated semantic anchors;
- browser ARIA, including empty or partial readings;
- information identity across re-sensing;
- anything unobserved or externally unavailable.

When headed, say which paint layers the user can see and whether the page is
still stabilized. When an external fixture, URL, browser binary, or product task
is unavailable, mark that boundary unvalidated rather than substituting a
constructed page and claiming completion.
