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

## Setup

This skill calls a library from TypeScript. `@variance-authority/presentation`
ships no CLI binary: there is no `variance` command in it, and the only commands
below are the install and the build. Playwright's own binary is invoked through
`npx`, as a devDependency is.

```sh
npm install --save-dev @variance-authority/presentation @playwright/test
npx playwright install chromium
```

- Node `>=22`. `@playwright/test` `>=1.49 <2` is an optional peer, required for
  every entry point under `@variance-authority/presentation/playwright` and for
  nothing else.
- Two entry points: `@variance-authority/presentation` (pure: analyze, focus,
  inspect, compare, signal) and `@variance-authority/presentation/playwright`
  (live: sense, paint, clear). Nothing else is exported.
- To type a capture yourself, also declare `@variance-authority/core` — the
  `RawCapture` and `AccessibilitySnapshot` types live at
  `@variance-authority/core/format`. It arrives transitively as a dependency of
  this package, but an undeclared import of it is a resolution accident.
- No configuration file is read. No run must have happened first. The working
  directory does not matter. Nothing is cached: this package writes nothing to
  `~/.cache/variance-authority/` and has no freshness to invalidate.

### The page agent bundle

`sensePresentation` and every paint entry point install a prebuilt IIFE into the
inspected page. It is read from `dist/browser-agent.bundle.js`, is generated at
build time, and is not committed. Check for it before the first live call:

```sh
ls node_modules/@variance-authority/presentation/dist/browser-agent.bundle.js
```

In a checkout of this repository the path is
`packages/presentation/dist/browser-agent.bundle.js`, and it is produced by the
root build, which runs `tsc --build` and then bundles every page agent:

```sh
yarn build    # tsc --build && node tools/page-agents.mjs && …
```

`tsc --build` alone does **not** produce it. If it is absent, the failure is
explicit, names both paths it looked in, and says which case you are in:

```
the presentation sensing agent bundle is missing (looked in
/…/packages/presentation/dist/browser-agent.bundle.js and
/…/packages/presentation/dist/browser-agent.bundle.js); it is built when the package is
built: a checkout is missing its build, and an installed copy is missing a published file
```

Build the checkout, or reinstall the package. Do not replace a missing bundle
with an empty or improvised page script.

## Authority boundary

Preserve product meaning and expose rendered relationships.

Use this authority order: product meaning → structural ownership → rendered
relationship → component contract → design-system token. A token is evidence of
implementation, never authorization for the relationship in which it appears.

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
the application. If the request also asks for an implementation change, make the
change the product task authorizes — the boundary above is on what this package
authorizes, not on what you are allowed to do. A finding is evidence for the
edit, never the instruction for it: nothing here tells you which margin, token,
or layout to write.

## Choose the entry point

| Starting state | Entry point | Result |
|---|---|---|
| A live Playwright `Page` and subject `Locator` | `sensePresentation` from `@variance-authority/presentation/playwright` | Acquires browser layout and Playwright ARIA, analyzes them, and optionally paints the page |
| An existing `RawCapture` | `analyzePresentation` from `@variance-authority/presentation` | Pure report derivation; browser accessibility is optional independent evidence |
| One structural level in an existing report | `focusPresentation` from `@variance-authority/presentation` | Pure owner reading that keeps nested evidence separate by default |
| Product-known visual peers across wrappers | `inspectPresentationAlignment` plus `paintPresentationAlignment` | Explicit coordinates, spread, member deviations, and matching paint without a verdict or another acquisition |
| Consecutive regions arranged by one box or composition | `inspectPresentationSpacing` plus `paintPresentationSpacing` | Every adjacent gap and boundary at that owner, even when the regions have different semantic shapes |
| Product-known hierarchy roles across nested owners | `inspectPresentationHierarchy` plus `paintPresentationHierarchy` | Typed outside-in relationship levels, adjacent collisions, findings, and role-labelled paint |
| Two presentation reports | `comparePresentation`, or `presentationSignal` when the evidence must travel with a general run report | Optional edit feedback, or introduced/resolved/persisted consequences with information identity retained separately from the verdict |

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
2. For a deliberately holistic question, call
   `focusPresentation(report, ownerId, { depth: 'subtree' })` and state why
   descendants belong in the same reading.
3. For a visual flow that crosses wrappers, explicitly select its concrete
   nodes with `inspectPresentationAlignment`. Select one structural level rather
   than both a semantic wrapper and its nested control. The API measures the
   relationship; the product task authorizes the peer set.
4. For a box or composition that arranges different kinds of adjacent region,
   inspect its consecutive immediate children with `inspectPresentationSpacing`.
   Read every separation, not only repeated patterns or existing findings.
   Compare the sequence of gaps and boundary strengths as one rhythm; then
   descend into a child only to answer a separate internal-spacing question.
   Do not stop after comparing the owner's outside gap with its internal median:
   when a leading heading or structural label introduces repeated body blocks,
   compare `leading → first body` with `body → next body`. Equal relationship
   classes erase that level of the visual hierarchy even when the owner's outer
   boundary remains stronger.
5. When product meaning identifies the roles, declare them with
   `inspectPresentationHierarchy`: `owner-boundary`, `leading-to-body`,
   `body-peer`, then `content-internal`. Do not derive those roles from token
   names. The contract rejects reversed levels, duplicated roles, reused
   relationships and nodes outside its owner.
6. Challenge a clean report with one explicit pass over the mapped hierarchy:
   identify the relationship classes automatic inference did not compare, and
   measure them. One pass, not repeated rounds — it ends when every
   product-authorized peer set and relationship role in the map has been
   measured, whether that took one reading or six. Do not manufacture intent to
   force a finding.
7. Isolate one finding id before paint. Add a pattern or measurement layer only
   when it answers the same question.
8. When the work is part of a regression run, call `presentationSignal` with the
   before and after reports plus their product-owned hierarchy readings, and put
   the result on the observation's `signals.presentation` field (see
   [Contribute the signal to a run](#contribute-the-signal-to-a-run)). Do not
   translate it into a render impact or change the observation verdict.

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
- `stabilize`: optional intervention ids replacing the default recipe entirely.
  The ids this build knows are `hold-animations`, `pin-animations`,
  `hide-caret`, `hide-scrollbars`, `hide-presentational-images`,
  `wait-for-fonts` and `wait-for-images`; an unknown id throws and lists them.
  The default recipe is `pin-animations`, `hide-scrollbars`, `hide-caret`,
  `wait-for-fonts`, and — in place of `wait-for-images` — an internal wait that
  settles only images inside the subject and its portals. Passing `stabilize`
  loses that narrowing, so pass it only to change stabilization, never to
  restate the default. Use `[]` only when the caller owns a static document,
  such as an MHTML archive whose page clock cannot advance.
- `paint`: omit for no overlay, use `true` for all layers, or provide selected
  layer names.

Prefer an unpainted first acquisition — omit `paint` here — so the hierarchy can
decide which evidence to show, then paint one focused reading with
`paintPresentationFocus`. Pass `paint` to `sensePresentation` only when the
overlay is wanted at the moment of acquisition and the layers are already known,
typically a headed session the user is watching.

Sensing the `main` of a six-record list returns, for example:

```
digest v1:7367a05e4d84f7ab651b39200e3dea6d
contentDigest v1:5c4b203f95db4b539b04ba726de6d42d
nodes 27 relations 143
telemetry {"content":{"elements":27,"characters":379,"estimatedLines":19,"controls":0,
  "repeatedObjects":18},"dimensions":{"regionWidthPx":1008,"regionHeightPx":579.91,
  "viewportWidthPx":1024,"viewportHeightPx":768,"viewportHeights":0.76},
  "utilization":{"horizontal":0.984,"occupiedArea":0.648}, …}
findings [
 { "id": "F1", "rule": "REPETITION_GRAMMAR_COLLAPSE", "owner": "r0:0/1",
   "nodes": ["r0:0/1/1","r0:0/1/3","r0:0/1/5","r0:0/1/7","r0:0/1/9","r0:0/1/11"],
   "pattern": "R7",
   "measurements": { "instances": 6, "betweenBoundaryMedian": 0.25, "presentationSimilarity": 1 } },
 { "id": "F3", "rule": "SPACING_HIERARCHY_COLLISION", "owner": "r0:0/1",
   "nodes": ["r0:0/1/1","r0:0/1/3","r0:0/1/5","r0:0/1/7","r0:0/1/9","r0:0/1/11"],
   "pattern": "R7",
   "measurements": { "instances": 6, "leadingToBodyGapMedianPx": 8, "bodyToBodyGapMedianPx": 8,
     "ratio": 1, "sharedSpacingClusterInstances": 6 } }
]
```

The browser agent waits for Suspense, settles images inside the subject and its
portals rather than unrelated document images, applies the other collection
interventions, collects computed style and layout, reads Playwright's ARIA
snapshot for the subject and portals, analyzes the plain capture, and then
optionally paints from the returned report. It does not capture a PNG. Do not
use an empty stabilization recipe to make a live page faster; it is a
declaration that the document cannot move.

Stabilization is injected as one `<style>` element marked `data-va-stabilize`,
skipped by the capture's own stylesheet index, and deliberately left in the
document. See the missing-bundle case under [Setup](#the-page-agent-bundle).

## Work headed with a user

The same live entry point works with a headed Playwright browser. This script
owns the browser it launches, so it also closes it; `APP_URL` is the address of
an application the user already has running — this package starts no server, and
nothing here listens on any particular port. With no application to point at,
`await page.setContent('<main>…</main>')` senses an inline document instead.

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
await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:3000');

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

await page.pause(); // headed only — in a headless browser this never returns
await clearPresentationPaint(page);
await browser.close();
```

Use headed operation when the user asks to see the evidence, challenge a
grouping, or work through an edit together. Explain which layers are visible and
connect any painted mark to its report measurement id.

`paintPresentationFocus` returns the number of marks it drew — `6` for a focus
whose `paint` holds six instructions — and `0` means nothing was painted.

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
- Whoever launched the browser closes it. A script that launched its own, as
  above, closes it when it ends; a page handed to you by a test or by the user's
  own session is closed by that caller, and you leave it open. Never close a
  browser you did not launch, and never leave one you did launch running past
  the work.

## Analyze an existing capture

```ts
import type { AccessibilitySnapshot, RawCapture } from '@variance-authority/core/format';
import { analyzePresentation } from '@variance-authority/presentation';

declare const capture: RawCapture;
declare const accessibility: AccessibilitySnapshot | undefined;

const report = analyzePresentation(capture, {
  ...(accessibility === undefined ? {} : { accessibility }),
});
```

A `RawCapture` is the neutral browser capture format of
`@variance-authority/core/format`. It is produced inside a page by `collect()`
from `@variance-authority/dom`, and reaches you already made: as the `capture`
field of what this package's own browser agent returns, or from a collector that
persists one (`@variance-authority/storybook-collector`,
`@variance-authority/route-collector`, the Playwright harness). This package
never reads one from disk and defines no file argument, path, or config of its
own — you hand it the object. `accessibility` is built by `accessibilitySnapshot`
from `@variance-authority/core/format`; omit it when browser ARIA was not
observed.

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
  inspectPresentationHierarchy,
  inspectPresentationSpacing,
} from '@variance-authority/presentation';
import {
  paintPresentationAlignment,
  paintPresentationFocus,
  paintPresentationHierarchy,
  paintPresentationSpacing,
} from '@variance-authority/presentation/playwright';
import type { Page } from '@playwright/test';
import type { PresentationReport } from '@variance-authority/presentation';

declare const page: Page;
declare const report: PresentationReport;

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
await paintPresentationAlignment(page, navFlow);

const composition = report.graph.nodes.find((node) => node.parent === undefined)!;
const rhythm = inspectPresentationSpacing(
  report,
  composition.id,
  composition.children,
  'vertical',
);
console.log(rhythm.distance, rhythm.boundary, rhythm.separations);
await paintPresentationSpacing(page, rhythm);

const hierarchy = inspectPresentationHierarchy(report, {
  id: 'record-hierarchy',
  owner: composition.id,
  axis: 'vertical',
  levels: [
    { role: 'leading-to-body', relations: [{ from: 'r0:0/1/0', to: 'r0:0/1/1' }] },
    { role: 'body-peer', relations: [{ from: 'r0:0/1/1', to: 'r0:0/1/2' }] },
  ],
});
console.log(hierarchy.collisions, hierarchy.findings);
await paintPresentationHierarchy(page, hierarchy);
```

### What each reading returns

`focusPresentation(report, ownerId, options?)` takes `depth` (`'owner'`, the
default, or `'subtree'`), `paint` (layer names; omit to keep every layer the
depth owns) and `findings` (finding ids; omit to keep every owned finding). It
returns `{ formatVersion, report, depth, owner, nodes, patterns, findings,
paint, nested }`, where `nested` counts what an owner focus deliberately left
below it:

```
focus nested {"owners":6,"patterns":6,"findings":0} nodes 7 paint 6 depth owner
```

`inspectPresentationAlignment(report, ownerId, memberIds, kind)` returns
`{ owner, kind, coordinatePx, spreadPx, members, paint }`; each member is
`{ node, coordinatePx, deviationPx }`:

```
{"kind":"vertical-center","coordinatePx":153.91,"spreadPx":102,
 "members":[{"id":"r0:0/1/1","coordinatePx":102.91,"deviationPx":-51},
            {"id":"r0:0/1/3","coordinatePx":204.91,"deviationPx":51}]}
```

`inspectPresentationSpacing(report, ownerId, memberIds, axis)` returns
`{ owner, axis, members, separations, distance, boundary, paint }`. Each
separation is `{ from, to, distancePx, boundaryStrength, spacingCluster? }`;
`distance` is `{ minPx, medianPx, maxPx }` and `boundary` is
`{ min, median, max }`:

```
rhythm distance {"minPx":19.91,"medianPx":19.91,"maxPx":19.91}
       boundary {"min":0.357,"median":0.357,"max":0.357}
```

`inspectPresentationHierarchy(report, contract)` takes a contract of
`{ id, owner, axis, levels }`, each level `{ role, relations: [{ from, to }] }`,
and returns `{ contract, owner, levels, collisions, findings, paint }`. Each
level gains `separations`, `distanceMedianPx`, `boundaryMedian` and
`spacingClusters`; each collision is `{ outer, inner, outerMedianPx,
innerMedianPx, ratio, sharedSpacingClusters }`:

```
hierarchy levels: [{"role":"leading-to-body","distanceMedianPx":20,"boundaryMedian":0.357,
                    "spacingClusters":["S2"]},
                   {"role":"body-peer","distanceMedianPx":8,"boundaryMedian":0.25,
                    "spacingClusters":["S1"]}]
hierarchy collisions: []
hierarchy findings: []
```

Every reading also carries `formatVersion: 1` and `report`, the digest of the
report it was read from. A reading is only valid against that report.

`focusPresentation` refuses an unknown owner and refuses a requested finding
that is not owned at the selected depth. `inspectPresentationAlignment` refuses
fewer than two distinct members, unknown members and members outside the owner.
Its spread is neutral measurement, not a threshold or finding. Alignment paint
shows only the selected flow: one median axis and one deviation-labelled box per
member. Role or name matching can discover candidates, but it does not authorize
flattening a matching container and its matching descendant into the same flow.

`inspectPresentationSpacing` refuses descendants, skipped siblings and an axis
that does not describe the owned separations. Its range summaries do not replace
the sequence: several touching regions followed by one spacious boundary is
different evidence from a uniformly spaced composition with the same maximum.
Heterogeneous regions are not required to align or repeat; their shared owner is
what makes their adjacent spacing one inspectable relationship.

`inspectPresentationHierarchy` is the product-owned route when automatic
inference or a design system cannot establish meaning. Read every level and its
pair before the collisions. Equal token values across adjacent roles are
evidence of a collision, but token validity, popularity and naming do not alter
the result. Treat the contract as a falsifiable hypothesis: the owner, nodes,
axis and outside-in order must survive inspection of the rendered graph.

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

Every finding is `{ id, rule, owner, nodes, pattern?, contract?, measurements }`.
`measurements` is a flat record of numbers and strings, and its keys are fixed
per rule:

| Rule | Evidence required | `measurements` keys |
|---|---|---|
| `SEPARATION_COLLISION` | Between-object boundary strength is indistinguishable from within-object boundaries | `withinBoundaryMedian`, `betweenBoundaryMedian`, `ratio` |
| `SPACING_RELATION_COLLISION` | Different relationship classes occupy the same inferred spacing cluster or distribution | `withinGapMedianPx`, `betweenGapMedianPx`, `ratio` |
| `SPACING_HIERARCHY_COLLISION` (inferred, from a repeated pattern) | A leading structural label is separated from its first body block exactly like ordinary body peers are separated from one another | `instances`, `leadingToBodyGapMedianPx`, `bodyToBodyGapMedianPx`, `ratio`, `sharedSpacingClusterInstances` |
| `SPACING_HIERARCHY_COLLISION` (declared, from `inspectPresentationHierarchy`) | Two adjacent declared roles measure alike | `outerRole`, `innerRole`, `outerMedianPx`, `innerMedianPx`, `ratio`, `sharedSpacingClusters` |
| `ALIGNMENT_OUTLIER` | One corresponding peer departs from a dominant alignment axis | `slot`, `dominantLeftPx`, `maxDeviationPx` |
| `BASELINE_DRIFT` | One corresponding text-bearing peer departs from an inferred baseline | `slot`, `dominantBaselinePx`, `maxDeviationPx`, `confidence` |
| `PROMINENCE_COLLAPSE` | A heading class and an ordinary text class occupy the same prominence treatment | `prominenceCluster`, `semanticClasses`, `magnitude` |
| `SURFACE_COLLISION` | A meaningful painted surface has low perceptual difference from its container and no border or shadow contribution | `perceptualDifference`, `borderWidthPx`, `shadow` |
| `REPETITION_GRAMMAR_COLLAPSE` | Repeated objects have weak between-instance boundary evidence | `instances`, `betweenBoundaryMedian`, `presentationSimilarity` |
| `PRESENTATION_GRAMMAR_DRIFT` | A peer departs from a dominant signature without observed semantic state explaining it | `dominantInstances`, `peerInstances`, `maxDeviation` |

The two `SPACING_HIERARCHY_COLLISION` shapes are the same rule reached two ways:
one inferred over a repeated pattern (carrying `pattern`), one measured against a
declared contract (carrying `contract`). They do not share measurement keys.

Read measurements before prose. Name the involved nodes, pattern, coordinates,
ratios, distances, clusters, or perceptual difference. Then connect that evidence
to the product task. Do not translate a finding into “looks wrong.”

Thresholds are analyzer calibration. They are not user-facing design targets.
A hierarchy-spacing finding is relational, not a preferred margin. Report the
measurement keys above verbatim — for the inferred form,
`leadingToBodyGapMedianPx`, `bodyToBodyGapMedianPx`, `ratio` and
`sharedSpacingClusterInstances`. Its finding paint draws both relations for each affected instance, so the
equal steps remain visible instead of replacing them with one enclosing box.

A report with no findings is not a claim that the interface is good; it means no
implemented relationship rule fired on the observed evidence. In particular,
automatic relationship findings are local to inferred repeated patterns. Use an
explicit spacing reading when the hierarchy says heterogeneous siblings form a
composition whose rhythm must be inspected holistically.

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
import type { PresentationReport } from '@variance-authority/presentation';

declare const before: PresentationReport;
declare const after: PresentationReport;

const feedback = comparePresentation(before, after);
```

It returns `{ formatVersion, before, after, findings, information }` — per-rule
counts, not per-finding identities:

```
{ "before": "v1:0319b89f76a26c6370f69805088fb3a0",
  "after": "v1:a841d3a4cac87c9d248174c38d291756",
  "findings": [ { "rule": "SEPARATION_COLLISION", "before": 1, "after": 1, "delta": 0 },
                { "rule": "SPACING_HIERARCHY_COLLISION", "before": 1, "after": 0, "delta": -1 } ],
  "information": { "content": { "before": "v1:3db37a…", "after": "v1:3db37a…", "preserved": true },
                   "characters": { "before": 167, "after": 167 },
                   "elements": { "before": 19, "after": 19 },
                   "repeatedObjects": { "before": 12, "after": 12 } } }
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

## Contribute the signal to a run

```ts
import { presentationSignal } from '@variance-authority/presentation';
import type {
  PresentationHierarchyReading,
  PresentationReport,
} from '@variance-authority/presentation';

declare const before: PresentationReport;
declare const after: PresentationReport;
declare const beforeRecordHierarchy: PresentationHierarchyReading;
declare const afterRecordHierarchy: PresentationHierarchyReading;

const signal = presentationSignal(before, after, {
  beforeHierarchy: [beforeRecordHierarchy],
  afterHierarchy: [afterRecordHierarchy],
});
```

`presentationSignal(before, after, options?)` takes two `PresentationReport |
undefined` positionally — baseline first, candidate second — and an options
object whose only members are `beforeHierarchy` and `afterHierarchy`, arrays of
`PresentationHierarchyReading`. Each reading must have been read from the report
it is passed beside; a reading whose `report` digest does not match throws. The
declared findings are unioned with the report's own.

It returns a `PresentationSignalRecord` from `@variance-authority/report`, which
is exactly what `ObservationRecord.signals.presentation` accepts — assign it
there, unchanged. Nothing intermediate holds it: this function produces the
record and the run's observation carries it.

```
{ "verdict": "changed",
  "before": "v1:0319b89f76a26c6370f69805088fb3a0",
  "after": "v1:a841d3a4cac87c9d248174c38d291756",
  "information": { "contentPreserved": true,
                   "characters": { "before": 167, "after": 167, "delta": 0 },
                   "elements": { "before": 19, "after": 19, "delta": 0 },
                   "repeatedObjects": { "before": 12, "after": 12, "delta": 0 } },
  "effects": [ { "rule": "SPACING_HIERARCHY_COLLISION", "owner": "r0:0/1",
                 "nodes": ["r0:0/1/1","r0:0/1/3","r0:0/1/5","r0:0/1/7"],
                 "pattern": "R5", "transition": "resolved",
                 "before": { "finding": "F3", "measurements": { … } } } ] }
```

`verdict` is `changed`, `unchanged`, or `incomparable`; each effect's
`transition` is `introduced`, `resolved`, or `persisted`. A missing report, or
one with no layout findings at all, is `incomparable` and never clean:

```
{"verdict":"incomparable","because":"the baseline supplied no presentation reading",
 "after":"v1:a841d3a4cac87c9d248174c38d291756"}
```

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
