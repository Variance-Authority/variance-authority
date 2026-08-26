# @variance-authority/presentation

**Requires:** a `RawCapture`; the live sensing entry creates one through
Playwright. Layout-derived evidence is available only when the capture's profile
observes computed style and layout.

Sense one rendered subject and return a machine-readable presentation graph. The
report keeps semantic anchors attached to concrete element references, measures
geometry and presentation relationships, and exposes deterministic collapse or
drift without recommending a layout or assigning a UI quality score.

This is a sensing and support surface, not a visual-regression assertion. It does
not create a baseline, approve a change, or produce a pass/fail verdict.

The packaged [`variance-presentation`](skills/variance-presentation/SKILL.md)
skill gives coding agents the complete live, raw-capture, headed collaboration,
ARIA, paint, finding, and re-sensing workflow.

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
unpainted. `focusPresentation` reads one owner from that report without touching
the page again. Its default `owner` depth includes the owner and its immediate
children; evidence owned by nested boxes is counted in `nested` rather than
folded into the current reading. Use `depth: 'subtree'` only when the product
question deliberately treats the complete composition as one subject.

Focus options are `depth`, `paint`, and `findings`. `depth` defaults to `owner`;
`paint` limits retained layers; `findings` limits the reading to report-local
finding ids owned at the selected depth.

Every finding has a stable report-local `id` and the graph-node `owner` whose
relationship produced it. Pass `findings: [id]` to isolate one question. Paint
that focused evidence without another acquisition:

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
`fonts` records the browser fonts whose identities the caller has established.
`suspense` controls settlement of React boundaries before sensing. `paint` is
either `true` for every diagnostic layer or a list of named layers; omitting it
leaves the page unpainted.

Use the pure entry point below when another collector already supplies a
`RawCapture`.

## Inspect a visual flow across nested boxes

DOM wrappers do not decide which rendered objects the product treats as one
visual flow. When peers such as a brand mark and navigation controls live in
different nested boxes, select those concrete graph nodes explicitly:

```ts
import {
  inspectPresentationAlignment,
  type PresentationReport,
} from '@variance-authority/presentation';

declare const report: PresentationReport;

const reading = inspectPresentationAlignment(
  report,
  'r0:0',
  ['r0:0/0/0', 'r0:0/1/0', 'r0:0/1/1', 'r0:0/1/2'],
  'vertical-center',
);

console.log(reading.coordinatePx, reading.spreadPx, reading.members);
```

The owner must contain every selected member and at least two distinct members
are required. The result reports coordinates and deviations; it does not turn
their spread into a finding or a design target. The caller remains responsible
for saying that those nodes belong to one visual flow.

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

Finding counts and information evidence remain separate. Re-sensing can
therefore show fewer collapsed relationships beside a presentation-independent
content identity and the element, character, and repeated-object counts. A
matching content identity proves the semantic classes, names, text, state, and
browser ARIA reading held while presentation moved. The identity is derived
before layout analysis, so the same boundary holds for a capture whose layout is
unobserved. Neither side is folded into a global score or verdict, and no stored
baseline is required.

See [Presentation intelligence](../../docs/presentation.md) for the report model,
finding boundaries, and paint layers.
