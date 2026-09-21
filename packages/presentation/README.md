<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/presentation

> Measure how a rendered interface groups, separates, aligns and emphasizes its content, and return those measurements as data a test or an agent can read.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

Your spacing tokens say the hierarchy is intact. The rendered page disagrees.

A heading and the paragraph under it both resolve to `--space-2` and both look
correct in the design file, but at the rendered size the gap between two cards
is the same as the gap inside a card, so six records read as one block of text.
Nothing in the stylesheet is wrong. Nothing in a screenshot diff is different
either, because this is how the page has always shipped. The only thing that
would tell you is a measurement of the rendered boxes, and you do not have one.

This package takes that measurement. Point it at a live Playwright locator and
it returns a graph of the rendered elements, the relationships between them —
gap, alignment, shared baseline, relative visual weight, repetition — and a list
of places where a distinction the structure implies is not present in the
pixels. It never decides that a design is good, picks a spacing value, or
produces a pass/fail result; you assert on the numbers it hands back.

Three words are used throughout with narrow meanings:

- **Subject** — one named UI state you asked for and can ask for again. Here it
  is the locator you pass in, and everything inside it.
- **Owner** — the element whose immediate structural relationship produced a
  measurement: the box that arranges the children involved, not the children
  themselves. Every finding names one.
- **Read** (or *sense*) — acquire the subject's geometry, computed style and
  ARIA in one pass and derive the graph from it. Reading touches the page;
  everything after it works on the returned report.

## Requirements

Node 22 or newer. Every `@variance-authority/*` package is ESM-only.

| Peer | Range | Required |
| --- | --- | --- |
| `@playwright/test` | `>=1.49 <2` | only for `@variance-authority/presentation/playwright` |

The live entry point uses engine-neutral Playwright APIs and reads geometry from
whichever browser you launched; the package's own browser suite runs on
Chromium. `analyzePresentation` needs no browser at all.

## Read one rendered subject

```bash
npm install --save-dev @variance-authority/presentation @playwright/test
npx playwright install chromium
```

A complete test. It navigates, reads the region you name, and prints what it
found — no assertion yet, so it passes and shows you the shape of the evidence:

```ts
// tests/orders-presentation.spec.ts
import { test } from '@playwright/test';
import { sensePresentation } from '@variance-authority/presentation/playwright';

test('reads the order list as presentation evidence', async ({ page }) => {
  await page.goto('http://localhost:5173/orders');

  const report = await sensePresentation(page, page.getByRole('main'), {
    subjectId: 'orders:list',
  });

  console.log(JSON.stringify(report.findings, null, 2));
  console.log(report.telemetry.content);
});
```

`sensePresentation` holds the page still before it measures — animations pinned,
scrollbars and caret hidden, fonts and the subject's own images awaited. It
creates no baseline and writes no file. The hold is not lifted when the read
returns: the stabilization stylesheet stays on the page, so anything you do next
sees a held page. That is usually what a following visual assertion wants;
reload if you need the live one back.

### What you get

`report.findings` for a list of six repeated records where the gap between
records is 4px and the gap inside each record is also 4px, abridged to three of
the nine entries:

```json
[
  {
    "id": "F1",
    "rule": "PROMINENCE_COLLAPSE",
    "owner": "r0:0/0",
    "nodes": ["r0:0/0/0", "r0:0/0/1"],
    "measurements": {
      "prominenceCluster": "P1",
      "semanticClasses": "heading:3,paragraph",
      "magnitude": 4.635
    }
  },
  {
    "id": "F7",
    "rule": "REPETITION_GRAMMAR_COLLAPSE",
    "owner": "r0:0",
    "nodes": ["r0:0/0", "r0:0/1", "r0:0/2", "r0:0/3", "r0:0/4", "r0:0/5"],
    "pattern": "R1",
    "measurements": {
      "instances": 6,
      "betweenBoundaryMedian": 0.25,
      "presentationSimilarity": 1
    }
  },
  {
    "id": "F9",
    "rule": "SPACING_RELATION_COLLISION",
    "owner": "r0:0",
    "nodes": ["r0:0/0", "r0:0/1", "r0:0/2", "r0:0/3", "r0:0/4", "r0:0/5"],
    "pattern": "R1",
    "measurements": {
      "withinGapMedianPx": 4,
      "betweenGapMedianPx": 4,
      "ratio": 1
    }
  }
]
```

Read `F9` as: the six records are one repeated pattern, the median gap between
two records is 4px, the median gap inside a record is 4px, and their ratio is 1
— so the boundary between records gives no more separation than the boundary
between a record's own heading and body.

`id` is stable within one report and means nothing across two. `owner` and
`nodes` are graph node ids: a node id is a path from a capture root, so
`r0:0/1/2` is capture root `0`, its child `1`, and that child's child `2`. Root
`0` is the locator you passed; later roots are React portal content in capture
order. Get real ids from `report.graph.nodes`.

Alongside the findings, `report.telemetry` records content volume, dimensions,
utilization and density as neutral context — it never produces a finding on its
own:

```json
{
  "content": { "elements": 19, "characters": 54, "estimatedLines": 12, "controls": 0, "repeatedObjects": 6 },
  "dimensions": { "regionWidthPx": 320, "regionHeightPx": 236, "viewportWidthPx": 1024, "viewportHeightPx": 768, "viewportHeights": 0.31 },
  "utilization": { "horizontal": 0.313, "occupiedArea": 0.508 },
  "density": { "charactersPer1000Px2": 0.715, "linesPerViewport": 12, "controlsPerViewport": 0, "repeatedObjectsPerViewport": 6 }
}
```

## The nine findings

Every finding is one of two shapes. A **collapse** is a distinction that should
be present disappearing — a gap that should separate repeated records, a size
difference that should separate a heading from body text. A **drift** is one
instance diverging from the pattern its peers share.

| `rule` | Shape | Reported when |
| --- | --- | --- |
| `SEPARATION_COLLISION` | collapse | The boundary between repeated instances is no stronger than the boundary inside one instance (ratio ≤ 1.15). |
| `SPACING_RELATION_COLLISION` | collapse | The gap between instances and the gap inside an instance fall in one spacing cluster, or differ by ≤ 1.15x. |
| `SPACING_HIERARCHY_COLLISION` | collapse | Two adjacent roles you declared share a spacing cluster, or their median gaps differ by ≤ 1.15x. |
| `SURFACE_COLLISION` | collapse | An element that reads as a surface — a button, input, article, dialog — is within 8 perceptual units of its container's fill, with no border and no shadow. |
| `PROMINENCE_COLLAPSE` | collapse | A heading and ordinary text under one owner land in the same visual-weight cluster. |
| `REPETITION_GRAMMAR_COLLAPSE` | collapse | Three or more instances repeat with a between-instance boundary strength ≤ 0.28. |
| `ALIGNMENT_OUTLIER` | drift | Two thirds of the instances share a left edge and at least one sits more than 2px off it. |
| `BASELINE_DRIFT` | drift | Two thirds of the instances share a text baseline and at least one sits more than 2px off it. |
| `PRESENTATION_GRAMMAR_DRIFT` | drift | An instance deviates from the dominant presentation signature and its own state does not explain the deviation. |

Geometry is exact: distances come from layout rects, not from pixels, so there
is no anti-aliasing or subpixel comparison anywhere in this package and no
screenshot is taken. The thresholds above are the tolerance — 2px for alignment
and baseline, 1.15x for a separation ratio — and they are pinned by the
package's acceptance fixtures rather than exposed as options.

**Spacing cluster** — adjacent gaps that measured close enough to be one
repeated value are given one cluster id (`S1`, `S2`, …) in `report.spacing`. Two
relationships sharing a cluster are the same gap as far as a reader is
concerned. **Boundary strength** is a 0–1 score combining whitespace, border
width, surface contrast, shadow and indent; it is how "separated" two boxes look
by every means at once, not just by gap.

## Turn a finding into a failed test

This package returns evidence and never a verdict, so the assertion is yours.
`report.findings` is an ordinary array — assert on it with the matchers your
runner already has:

```ts
import { expect, test } from '@playwright/test';
import { sensePresentation } from '@variance-authority/presentation/playwright';

test('order records stay visually separable', async ({ page }) => {
  await page.goto('http://localhost:5173/orders');
  const report = await sensePresentation(page, page.getByRole('main'));

  const collapses = report.findings?.filter(
    (finding) => finding.rule === 'SEPARATION_COLLISION' || finding.rule === 'REPETITION_GRAMMAR_COLLAPSE',
  );
  expect(collapses).toEqual([]);
});
```

`findings` is absent — not empty — when the capture had no layout evidence to
measure; `[]` means it was measured and clean. Keep those apart in an assertion
that must not pass on a capture that was never able to answer.

## Narrow the reading to one owner

`focusPresentation` reads one structural level out of a report you already have,
without touching the page again:

```ts
import { expect, test } from '@playwright/test';
import { focusPresentation } from '@variance-authority/presentation';
import { sensePresentation } from '@variance-authority/presentation/playwright';

test('the record list owns its separation problem', async ({ page }) => {
  await page.goto('http://localhost:5173/orders');
  const report = await sensePresentation(page, page.getByRole('main'));

  const pattern = report.patterns?.find((candidate) => candidate.instances.length >= 3);
  expect(pattern, 'the subject has no repeated presentation pattern').toBeDefined();

  const reading = focusPresentation(report, pattern!.parent, { paint: ['repetition', 'findings'] });
  console.log(reading.owner.id, reading.findings.map((finding) => finding.rule), reading.nested);
});
```

Options are `depth`, `paint` and `findings`. `depth` defaults to `owner`: the
owner and its immediate children. Evidence belonging to boxes nested below is
counted in `reading.nested` rather than folded into the reading, so a problem
inside one card does not read as a problem with the list. Use `depth: 'subtree'`
only when the product question deliberately treats the whole composition as one
subject. `findings: [id]` narrows the reading to one question; `paint` limits
which evidence layers are retained.

## Draw the evidence on the live page

**Paint** means drawing an SVG overlay of the measurements onto the page you
just read. The overlay is a real element in the document, so a screenshot taken
while it is up contains it — call `clearPresentationPaint(page)` before any
screenshot or visual-regression assertion that follows.

```ts
import { expect, test } from '@playwright/test';
import { focusPresentation } from '@variance-authority/presentation';
import {
  clearPresentationPaint,
  paintPresentationFocus,
  sensePresentation,
} from '@variance-authority/presentation/playwright';

test('paints one finding and leaves the page clean', async ({ page }) => {
  await page.goto('http://localhost:5173/orders');
  const report = await sensePresentation(page, page.getByRole('main'));

  const finding = report.findings?.[0];
  expect(finding).toBeDefined();

  const isolated = focusPresentation(report, finding!.owner, {
    findings: [finding!.id],
    paint: ['findings'],
  });
  await paintPresentationFocus(page, isolated);
  await page.screenshot({ path: 'orders-finding.png' });

  await clearPresentationPaint(page);
});
```

The layers are `semantic`, `spacing`, `axes`, `baselines`, `surfaces`,
`prominence`, `repetition` and `findings`. `sensePresentation` takes the same
names as its own `paint` option — `true` for all of them, a list for some —
and omitting it leaves the page unpainted, which is the normal choice while
reading.

## Remaining options for a read

| Option | What it does |
| --- | --- |
| `subjectId`, `title` | Name the sensed boundary in the returned report. Defaults to `presentation` with no title. |
| `fonts` | Font identities you established for this capture. The report returns them, and a substitution changes `report.digest` while `report.contentDigest` stays the same. |
| `suspense` | `{ timeoutMs }` for settling React boundaries before reading. |
| `stabilize` | Replaces the default stabilization recipe. |
| `paint` | `true`, or a list of the layers above. |
| `accessibility` | The browser-computed ARIA snapshot read beside this capture. The report keeps it as an independent semantic reading and it covers `report.contentDigest`. Leave it out only when nothing observed it. |

**Content identity** is `report.contentDigest`: a digest of semantic classes,
names, text, state and the browser ARIA reading, with no layout in it. It is
what lets you say the words and structure did not change while the presentation
moved, and it is derived before layout analysis, so it is present even for a
capture whose layout was never observed.

A **stabilization recipe** is a list of named interventions applied to the page
before it is read. The default here is the standard collection recipe —
`pin-animations`, `hide-scrollbars`, `hide-caret` and `wait-for-fonts` — with
`wait-for-images` narrowed to images inside your subject and its React portals,
so an unrelated hero image elsewhere in the document does not keep the read
waiting. The other ids you can name are `hold-animations`, `wait-for-images` and
`hide-presentational-images`; an id nothing answers to fails the read rather
than being skipped. Pass `stabilize: ['pin-animations']` to run only some of
them, and `stabilize: []` only for a static document you own, such as an MHTML
archive whose page clock cannot advance. A live page needs the default. What
each one buys is in
[Stabilization](https://variance-authority.dev/docs/stabilization).

Missing or partial ARIA is an observed value, not an error: a subject with no
ARIA, or a tree with no parent and no children, comes back as what it is.

## Inspect a visual flow across nested boxes

Use this when peers — a brand mark and navigation controls, say — live in
different DOM wrappers but should be read as one visual flow. Select their graph
node ids explicitly.

An excerpt: `page` and `report` come from the test above — a Playwright `Page`
and the report `sensePresentation` returned. The ids are hardcoded here for
readability; take real ones from `report.graph.nodes`.

```ts
import { inspectPresentationAlignment } from '@variance-authority/presentation';
import { paintPresentationAlignment } from '@variance-authority/presentation/playwright';

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
reports the median coordinate, the spread, and each member's signed deviation;
it adds no finding. Painting reuses the report and does not read the page again.

## Inspect spacing at a composition owner

Select consecutive immediate children at the owner that arranges them — they do
not need matching semantic shape to belong to one composition.

An excerpt, with the same `page` and `report` as above:

```ts
import { inspectPresentationSpacing } from '@variance-authority/presentation';
import { paintPresentationSpacing } from '@variance-authority/presentation/playwright';

const root = report.graph.nodes.find((node) => node.parent === undefined)!;
const reading = inspectPresentationSpacing(report, root.id, root.children, 'vertical');

console.log(reading.distance, reading.boundary, reading.separations);
await paintPresentationSpacing(page, reading);
```

`separations` preserves every adjacent distance, boundary strength and spacing
cluster; `distance` and `boundary` add min, median and max. Members must be
consecutive immediate children in the owner's structural order. The result is
evidence, not a preferred gap and not an automatic finding.

## Declare relationship roles instead of trusting tokens

This is the answer to the problem at the top of the page. Rather than asserting
that a gap equals a token, declare which measured separations stand for which
product-defined role, and let the measurement say whether two roles are actually
distinguishable in the rendered page.

An excerpt, with the same `page` and `report` as above:

```ts
import {
  inspectPresentationHierarchy,
  type PresentationHierarchyContract,
} from '@variance-authority/presentation';
import { paintPresentationHierarchy } from '@variance-authority/presentation/playwright';

const contract: PresentationHierarchyContract = {
  id: 'order-summary',
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
measured separation inside the declared owner, and one pair cannot fill two
roles. Two adjacent roles that share a spacing cluster, or whose median gaps
differ by 1.15x or less, produce a `SPACING_HIERARCHY_COLLISION` — its ids are
`H1`, `H2`, … within this reading, separate from the report's own `F` ids. The
result does not choose a replacement value. Paint labels each declared role.

## Analyze a capture with no browser

Use this when another collector already produced a `RawCapture` — a normalized,
serializable snapshot of one rendered DOM subject.

```bash
npm install --save-dev @variance-authority/presentation @variance-authority/core
```

An excerpt: `capture` is that snapshot, and `browserAccessibility` is the ARIA
tree observed beside it, if there was one.

```ts
import type { AccessibilitySnapshot, RawCapture } from '@variance-authority/core/format';
import { analyzePresentation } from '@variance-authority/presentation';

const report = analyzePresentation(capture, { accessibility: browserAccessibility });

console.log(report.telemetry, report.patterns, report.findings);
```

A capture's **profile** declares what its collector was capable of observing —
ARIA tree, declared style, computed style, layout, pixels — independent of what
it actually found. `analyzePresentation` reads that declaration rather than
guessing from missing data, so a JSDOM capture is never mistaken for a browser
capture that measured everything as zero.

A capture whose profile cannot observe layout still produces content telemetry
and semantic anchors; its `patterns`, `findings`, clusters and paint
instructions are absent rather than empty. A layout-capable capture that omits
an element rect is refused.

`patterns` describe repeated semantic shapes and their dominant presentation
signature. `findings` list measurements before prose: the nodes involved, the
pattern, coordinates, ratios, distances, cluster identities.

## Re-read after an edit

```ts
import { comparePresentation } from '@variance-authority/presentation';

const change = comparePresentation(before, after);
console.log(change.findings, change.information);
```

`before` and `after` are two reports of the same subject, read either side of
your change. `change.findings` gives a per-rule before/after/delta count;
`change.information` gives the content identity plus element, character and
repeated-object counts. They are reported separately and never folded into a
score. A matching content identity proves the content stayed the same while
presentation moved, so a re-read can report findings resolved alongside
unchanged content. No stored baseline is involved.

## Record the consequence in a run report

Use `presentationSignal` when the same consequence must survive the browser
session and travel with a general regression report.

```bash
npm install --save-dev @variance-authority/presentation @variance-authority/report
```

An excerpt: `before` and `after` are the two reports from above, and the
hierarchy readings are what `inspectPresentationHierarchy` returned on each
side.

```ts
import type { ObservationRecord } from '@variance-authority/report';
import { presentationSignal } from '@variance-authority/presentation';

const presentation = presentationSignal(before, after, {
  beforeHierarchy: [beforeHierarchy],
  afterHierarchy: [afterHierarchy],
});

const observation: ObservationRecord = {
  subject: 'orders:list',
  verdict: 'changed',
  because: 'the candidate differs from its baseline',
  changedPixels: 320,
  regions: [],
  signals: { presentation },
};

console.log(observation.signals?.presentation);
```

It matches relationship identities across the two reports and records which
effects were introduced, which were resolved, and which changed measurement.
`beforeHierarchy` and `afterHierarchy` are optional; omit both when the
automatic findings are the complete evidence for the subject.

A missing report, or a report with no layout findings to compare, produces
`verdict: 'incomparable'` with a `because` naming which side was missing —
never an empty clean list, because "we could not look" and "we looked and found
nothing" are different answers. The content identity and information counts
travel alongside the effects.

The stored signal reports consequence, not severity. Project policy still
decides whether any finding blocks a run.

Background on the evidence model and the before-and-after loop:
[Inspect presentation relationships during a UI edit](https://variance-authority.dev/docs/presentation)
and [Presentation evidence reference](https://variance-authority.dev/docs/presentation-reference).

---

**[@variance-authority/presentation](https://variance-authority.dev/reference/packages/presentation)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
