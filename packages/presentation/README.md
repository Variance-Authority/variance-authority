<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/presentation

> Sense spacing, alignment, prominence and repetition inside one live interface, as evidence an agent can read.

**Requires:** a `RawCapture` — a normalized, serializable snapshot of one
rendered DOM subject, produced by a collector such as this package's Playwright
entry point. Layout-derived evidence is available only when the capture's
profile — a declaration of what its collector could observe (ARIA, style,
layout, pixels) — includes computed style and layout.

Sense one rendered subject and return a machine-readable presentation graph. The
report keeps semantic anchors attached to concrete element references, measures
geometry and presentation relationships, and exposes deterministic collapse (the
gap that should separate repeated instances, or the size difference that should
separate a heading from body text, disappearing) and drift (one instance's
position, baseline, or presentation diverging from the dominant pattern) —
without recommending a layout or assigning a UI quality score.

This is a sensing and support surface, not a visual-regression assertion. It does
not create a baseline, approve a change, or produce a pass/fail verdict; pair it
with `@variance-authority/report` (or another comparison layer) when a run needs
one.

```bash
npm install --save-dev @variance-authority/presentation @playwright/test
npx playwright install chromium
```

## Sense once, then choose the structural owner

```ts
import type { Page } from '@playwright/test';
import { focusPresentation } from '@variance-authority/presentation';
import { sensePresentation } from '@variance-authority/presentation/playwright';

declare const page: Page;

const report = await sensePresentation(page, page.getByRole('main'));
const pattern = report.patterns?.find((candidate) => candidate.instances.length >= 3);
if (pattern === undefined) throw new Error('the subject has no repeated presentation pattern');

const ownerReading = focusPresentation(report, pattern.parent, {
  paint: ['repetition', 'findings'],
});

console.log(ownerReading.owner, ownerReading.findings, ownerReading.nested);
```

Playwright supplies the live layout and its ARIA snapshot. The browser agent
can paint from the same report it returns, but acquisition is normally left
unpainted. Its default settlement — the waits, for fonts, images, and
animations, that hold a page still before it is measured — covers images inside
the subject and its React portals, not unrelated images elsewhere in the
document.
`focusPresentation` reads one owner from that report without touching
the page again. Its default `owner` depth includes the owner and its immediate
children; evidence owned by nested boxes is counted in `nested` rather than
folded into the current reading. Use `depth: 'subtree'` only when the product
question deliberately treats the complete composition as one subject.

Focus options are `depth`, `paint`, and `findings`. `depth` defaults to `owner`;
`paint` limits retained layers; `findings` limits the reading to report-local
finding ids owned at the selected depth.

Every finding — a detected rule violation such as `SEPARATION_COLLISION`, tying
specific graph nodes to a measurement — has a stable report-local `id` and the
graph-node `owner` whose relationship produced it. Pass `findings: [id]` to
isolate one question. Paint that focused evidence without another acquisition:

```ts
import type { Page } from '@playwright/test';
import { focusPresentation, type PresentationReport } from '@variance-authority/presentation';
import { paintPresentationFocus } from '@variance-authority/presentation/playwright';

declare const page: Page;
declare const report: PresentationReport;

const finding = report.findings?.[0];
if (finding !== undefined) {
  const isolated = focusPresentation(report, finding.owner, {
    findings: [finding.id],
    paint: ['findings'],
  });
  await paintPresentationFocus(page, isolated);
}
```

Call `clearPresentationPaint(page)` to remove the overlay. No ARIA, or a partial
ARIA tree with no parent or children, remains an observed value rather than an
acquisition error.

`subjectId` and `title` identify the sensed boundary in the returned report.
`fonts` records the browser fonts whose identities the caller has established;
the report carries them back, and a substitution changes its digest while
content identity — a digest of semantic classes, names, text, state, and the
browser ARIA reading, independent of layout — holds.
`suspense` controls settlement of React boundaries before sensing. `paint` is
either `true` for every diagnostic layer (`semantic`, `spacing`, `axes`,
`baselines`, `surfaces`, `prominence`, `repetition`, `findings`) or a list of
named layers; omitting it leaves the page unpainted.

`stabilize` replaces the default collection recipe by intervention id. Pass an
empty list only for a caller-owned static document such as an MHTML archive whose
page clock cannot advance; a live page normally needs the default recipe.

Use the pure entry point below when another collector already supplies a
`RawCapture`.

## Inspect a visual flow across nested boxes

Use this when peers — a brand mark and navigation controls, say — live in
different DOM wrappers but should be read as one visual flow: select their graph
node ids explicitly. A node id encodes a path from a capture root, so
`r0:0/1/2` is capture root `0`, its child `1`, and that child's child `2`; get
real ids from `report.graph.nodes` rather than hardcoding them as this example
does:

```ts
import type { Page } from '@playwright/test';
import {
  inspectPresentationAlignment,
  type PresentationReport,
} from '@variance-authority/presentation';
import { paintPresentationAlignment } from '@variance-authority/presentation/playwright';

declare const page: Page;
declare const report: PresentationReport;

const reading = inspectPresentationAlignment(
  report,
  'r0:0',
  ['r0:0/0/0', 'r0:0/1/0', 'r0:0/1/1', 'r0:0/1/2'],
  'vertical-center',
);

console.log(reading.coordinatePx, reading.spreadPx, reading.members);
await paintPresentationAlignment(page, reading);
```

The owner must contain every selected member, and at least two distinct members
are required. Members must sit at one structural level — a wrapper and its own
nested control sharing a semantic role do not count as two peers. The result
reports coordinates and deviations; it does not add a finding. Its `paint`
marks the median axis and every selected member with its signed deviation;
painting reuses the report and does not acquire the page.

## Inspect spacing at a composition owner

Select consecutive immediate children at the owner that arranges them — they
don't need matching semantic shape to belong to one composition:

```ts
import {
  inspectPresentationSpacing,
  type PresentationReport,
} from '@variance-authority/presentation';
import type { Page } from '@playwright/test';
import { paintPresentationSpacing } from '@variance-authority/presentation/playwright';

declare const browserPage: Page;
declare const report: PresentationReport;

const page = report.graph.nodes.find((node) => node.parent === undefined)!;
const reading = inspectPresentationSpacing(report, page.id, page.children, 'vertical');

console.log(reading.distance, reading.boundary, reading.separations);
await paintPresentationSpacing(browserPage, reading);
```

The reading preserves every adjacent distance, boundary strength and spacing
cluster, plus min/median/max summaries. Members must be consecutive immediate
children in the owner's structural order. The result is evidence — distances and
clusters — not a preferred gap or an automatic finding.

## Declare relationship roles instead of trusting tokens

Declare which measured separations in an existing report stand for which
product-defined role, independent of the design-system token that implemented
the spacing:

```ts
import {
  inspectPresentationHierarchy,
  type PresentationHierarchyContract,
  type PresentationReport,
} from '@variance-authority/presentation';
import type { Page } from '@playwright/test';
import { paintPresentationHierarchy } from '@variance-authority/presentation/playwright';

declare const page: Page;
declare const report: PresentationReport;

const contract: PresentationHierarchyContract = {
  id: 'demand-record',
  owner: 'r0:0',
  axis: 'vertical',
  levels: [
    { role: 'owner-boundary', relations: [{ from: 'r0:0/0', to: 'r0:0/1' }] },
    { role: 'leading-to-body', relations: [{ from: 'r0:0/1/0', to: 'r0:0/1/1' }] },
    { role: 'body-peer', relations: [{ from: 'r0:0/1/1', to: 'r0:0/1/2' }] },
    { role: 'content-internal', relations: [{ from: 'r0:0/1/1/0', to: 'r0:0/1/1/1' }] },
  ],
};
const hierarchy = inspectPresentationHierarchy(report, contract);

console.log(hierarchy.levels, hierarchy.collisions, hierarchy.findings);
await paintPresentationHierarchy(page, hierarchy);
```

Roles are ordered outside-in and may not repeat. Every relationship must be a
measured separation inside the declared owner, and one pair cannot hold two
roles. Adjacent roles occupying the same spacing cluster or calibrated
distribution produce `SPACING_HIERARCHY_COLLISION` — a finding that two declared
roles are not actually distinguishable in the rendered spacing; the result does
not choose a replacement value. Paint labels each declared role.

## Analyze one capture

```ts
import type { AccessibilitySnapshot, RawCapture } from '@variance-authority/core';
import { analyzePresentation } from '@variance-authority/presentation';

declare const capture: RawCapture;
declare const browserAccessibility: AccessibilitySnapshot;

const report = analyzePresentation(capture, {
  accessibility: browserAccessibility,
});

console.log(report.telemetry, report.patterns, report.findings);
```

`telemetry` records content volume, dimensions, utilization, and density as
neutral context. It never creates a finding independently. `patterns` describe
repeated semantic shapes and their dominant presentation signatures. `findings`
contain measurements before prose: the involved nodes, pattern, coordinates,
ratios, distances, or cluster identities.

The browser accessibility snapshot is retained as an independent semantic
reading. The `accessibility` option omits that reading only when the browser did
not observe it. An empty root or a root with no parent or children is an observed
value and remains present without repair.

A capture whose profile cannot observe layout still produces content telemetry
and semantic anchors. Its layout-derived `patterns`, `findings`, clusters, and
paint instructions are absent rather than empty. A layout-capable capture that
omits an element rect is refused.

## Re-sense after an edit

```ts
import type { PresentationReport } from '@variance-authority/presentation';
import { comparePresentation } from '@variance-authority/presentation';

declare const before: PresentationReport;
declare const after: PresentationReport;

const change = comparePresentation(before, after);
console.log(change.findings, change.information);
```

`change.findings` and `change.information` are reported separately, never
folded into a global score or verdict. `information` holds the content identity
plus the element, character, and repeated-object counts. A matching content
identity proves content held while presentation moved; it is derived before
layout analysis, so the same check works for a capture whose layout is
unobserved. Re-sensing can therefore show fewer findings resolved alongside an
unchanged content identity, and no stored baseline is required.

## Carry presentation impact into a run report

Use `presentationSignal` when the same consequence must survive the browser
session and travel with a general regression report:

```ts
import type { ObservationRecord } from '@variance-authority/report';
import {
  presentationSignal,
  type PresentationHierarchyReading,
  type PresentationReport,
} from '@variance-authority/presentation';

declare const before: PresentationReport;
declare const after: PresentationReport;
declare const beforeHierarchy: PresentationHierarchyReading;
declare const afterHierarchy: PresentationHierarchyReading;

const presentation = presentationSignal(before, after, {
  beforeHierarchy: [beforeHierarchy],
  afterHierarchy: [afterHierarchy],
});

const observation: ObservationRecord = {
  subject: 'underwriting:demands',
  verdict: 'changed',
  because: 'the candidate differs from its baseline',
  changedPixels: 320,
  regions: [],
  signals: { presentation },
};

console.log(observation.signals?.presentation);
```

The function combines automatic findings with the supplied product-owned
hierarchy readings, matching relationship identities across the two reports and
recording introduced, resolved, and measurement-changing effects.
`beforeHierarchy` and `afterHierarchy` are optional; omit both when automatic
findings are the complete evidence for the subject. Missing reports or layout
findings produce `incomparable`, never an empty clean list. The content
identity and information counts travel alongside the effects.

The stored signal reports consequence only, not severity: renderer impact —
whether a changed CSS property can only repaint or must also reflow the page —
still answers how far a change can reach, and project policy still decides
whether any finding blocks a run. A collector that participates in the general
regression pipeline returns this value as its optional `presentation` field.
