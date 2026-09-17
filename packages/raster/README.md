<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/raster

> Measure a difference that was never zero, watch it drift, and refuse to photograph a subject that will not hold still.

Part of [Variance Authority](https://variance-authority.dev), a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source.

## What this is for

Three things, and the first two are not served by any snapshot tool you already
run.

**Measuring a difference that is allowed to be non-zero.** Two renderers that
never agreed, a font stack that is always slightly off, a compression pass that
always softens an edge — none of those has to be eliminated before you can watch
it, because what gets measured is the disagreement rather than either side of
it. `observeDifference` records the difference as it stands today;
`compareDifferenceObservations` tells you how it moved since you last recorded
it.

**Keeping severity and amount apart.** A pixel count collapses them into one
number, and the number is then dominated by area — which is how a one-pixel
spacing change reports thousands of differing pixels and means nothing by it.
The result here is a per-pixel field plus a curve `C(t)`, the proportion of the
image differing at severity `t` or above, so a broad weak change and a small
severe one stop looking alike.

**Deciding whether a subject is worth photographing, without photographing it.**
A *subject* is one named UI state you asked for and can ask for again. The usual
instability check shoots, waits, shoots again, and repeats until two frames
agree: two captures minimum on every subject, on the most expensive step in the
pipeline, and when it finally succeeds nobody learns which component would not
sit still. `gateStability` compares two *documents* instead — markup plus the
CSS that applies, no image — and one disagreement is the answer.

The rest of the package is the contracts those steps and the wider pipeline are
written against: what a render document assembles to, what a renderer promises,
what a baseline store promises, and which comparison policy a number came from.

## Use this package when

Reach for `@variance-authority/raster` when you already have decoded pixels, or
when you are wiring your own pipeline and need the contracts around rendering,
storage, plans and stability.

It does not decode PNGs, launch a browser, write a baseline, or choose a test
runner. If what you want is visual regression tests running end to end from a
project config, install
[`@variance-authority/cli`](https://variance-authority.dev/reference/packages/cli)
instead and never import this package directly.

Each capability this one leaves out is a separate package, named for the one
thing it requires:

| package | requires | what it adds |
|---|---|---|
| [`png`](https://variance-authority.dev/reference/packages/png) | a PNG codec | `decodeImage(bytes)` → a `NormalizedImage`, and `@variance-authority/png/difference` for the PNG-in, numbers-out form of everything below |
| [`playwright`](https://variance-authority.dev/reference/packages/playwright) | a browser | a `Renderer` that paints an assembled document, one browser per run |
| [`store`](https://variance-authority.dev/reference/packages/store) | a filesystem | a durable `RasterStore` over a directory or git-LFS |
| [`remote`](https://variance-authority.dev/reference/packages/remote) | a socket | a `Renderer` or `RasterStore` on the far side of an HTTP hop |
| [`observe`](https://variance-authority.dev/reference/packages/observe) | a PNG codec | compares two documents or rasters and returns one observation |

Nothing here imports any of them, so extending your own Playwright tests with
this vocabulary costs you no second browser, and keeping baselines somewhere
this project has never heard of costs you no disk.

## Requirements

Node 22 or newer. The package is ESM-only — `import` works, `require` does not.
Its one dependency is `@variance-authority/core`; there are no peers, and
installing it installs no browser, codec, filesystem client or HTTP client.

```bash
npm install --save-dev @variance-authority/raster @variance-authority/core
```

## Measure a difference that was never zero

`@variance-authority/raster/difference` is a second entrypoint with its own
question. Run this file as-is:

```js
// drift.mjs — node drift.mjs
import {
  YIQ_DISTANCE,
  observeDifference,
  compareDifferenceObservations,
  fieldStatistics,
} from '@variance-authority/raster/difference';

const WIDTH = 120;
const HEIGHT = 40;
// pixelmatch thresholds you already run, squared: 0.05, 0.1, 0.2, 0.4.
const LEVELS = [0.0025, 0.01, 0.04, 0.16];

// Stands in for two decoded screenshots: a white page with one dark band on it.
function panel({ left, ink }) {
  const data = new Uint8Array(WIDTH * HEIGHT * 4).fill(255);
  for (let y = 12; y < 28; y += 1) {
    for (let x = left; x < left + 60; x += 1) {
      const at = (y * WIDTH + x) * 4;
      data[at] = ink;
      data[at + 1] = ink;
      data[at + 2] = ink;
    }
  }
  return { width: WIDTH, height: HEIGHT, data, colorSpace: 'srgb', alphaMode: 'opaque' };
}

const chromium = panel({ left: 20, ink: 34 });
const webkit = panel({ left: 20, ink: 46 }); // never agreed: WebKit lays the ink down lighter
const webkitToday = panel({ left: 21, ink: 46 }); // and today the band sits one pixel right

const accepted = await observeDifference({
  firstImage: chromium,
  secondImage: webkit,
  metric: YIQ_DISTANCE,
  severityLevels: LEVELS,
});
const today = await observeDifference({
  firstImage: chromium,
  secondImage: webkitToday,
  metric: YIQ_DISTANCE,
  severityLevels: LEVELS,
});
const moved = compareDifferenceObservations(accepted, today);

console.log(
  'changed pixels  %d -> %d',
  fieldStatistics(accepted.field).changedPixels,
  fieldStatistics(today.field).changedPixels,
);
console.log(
  'peak severity   %s -> %s',
  moved.summary.baselineMaximum.toFixed(4),
  moved.summary.currentMaximum.toFixed(4),
);
for (const point of moved.curveDelta) {
  console.log(
    'severity >= %s  %d -> %d pixels (%s%% of the image)',
    point.severity.toFixed(4),
    point.baselinePixelCount,
    point.currentPixelCount,
    (point.currentImageRatio * 100).toFixed(2),
  );
}
console.log(
  'field delta     %d x %d signed values',
  moved.fieldDelta.signed.width,
  moved.fieldDelta.signed.height,
);
```

```text
changed pixels  960 -> 976
peak severity   0.0021 -> 0.7008
severity >= 0.0025  0 -> 32 pixels (0.67% of the image)
severity >= 0.0100  0 -> 32 pixels (0.67% of the image)
severity >= 0.0400  0 -> 32 pixels (0.67% of the image)
severity >= 0.1600  0 -> 32 pixels (0.67% of the image)
field delta     120 x 40 signed values
```

A pixel count reports sixteen more changed pixels, which is indistinguishable
from noise. The curve reports that thirty-two pixels crossed every level you
declared when none had before, and the peak went from `0.0021` to `0.7008` —
the standing ink disagreement stayed exactly where it was, and something new
landed on top of it.

To get `NormalizedImage` values out of real screenshots, decode them:
`decodeImage(bytes)` from
[`@variance-authority/png/difference`](https://variance-authority.dev/reference/packages/png)
is the supported route, and `observePngDifference` in the same module does the
decode and the observation in one call. This package never decodes anything; it
takes row-major RGBA, 8 bits per channel, with `colorSpace` and `alphaMode`
declared by whoever decoded it.

### What you get

`observeDifference` returns a `DifferenceObservation`. Abridged, from the run
above:

```js
{
  formatVersion: 'variance-difference/1',
  metric: {
    name: 'yiq-distance',
    version: '1',
    parameters: { alphaBackground: 'white' },
    unit: 'yiq-normalized',
    range: { minimum: 0, maximum: 1 },
  },
  image: { width: 120, height: 40, colorSpace: 'srgb', alphaMode: 'opaque' },
  normalization: { version: '1', parameters: { flattenOnto: 'none' } },
  field: { width: 120, height: 40, values: Float32Array(4800) },
  curve: [
    { severity: 0.0025, pixelCount: 0, imageRatio: 0 },
    { severity: 0.01, pixelCount: 0, imageRatio: 0 },
    { severity: 0.04, pixelCount: 0, imageRatio: 0 },
    { severity: 0.16, pixelCount: 0, imageRatio: 0 },
  ],
  sourceHashes: {
    firstImage: 'v1:e2d138c2c5d1c538520deb56b8b31f9d',
    secondImage: 'v1:d28fb7c162c3712ab87bc2ec091cf739',
  },
}
```

`field.values` is one non-negative number per pixel, row-major, where `0` means
*measured and equal* rather than *unmeasured* — a metric that cannot evaluate a
pixel throws instead of writing a zero. `curve` is that field counted at each
level you asked for. Everything else is what a later observation has to match
before the two can be compared at all; `compareDifferenceObservations` throws
`IncomparableObservationsError` when they do not, and `comparabilityReasons`
returns every mismatch at once if you would rather check first.

`compareDifferenceObservations` returns a `DifferenceComparison` whose three
interesting members are:

- `curveDelta` — one entry per severity level, carrying both observations'
  pixel counts and ratios and the difference between them. Small enough to
  store and graph. This is what the loop above printed.
- `fieldDelta` — `{ signed, increase, decrease }`, each a full-resolution
  `width × height` field. `signed` may go negative; `increase` and `decrease`
  are its two halves as magnitudes. Use these when something downstream has to
  cluster, attribute or draw the change.
- `summary` — `baselineMean`, `currentMean`, `meanDelta`, `baselineMaximum`,
  `currentMaximum`, `maximumDelta`, `totalIncrease`, `totalDecrease`.

There is no threshold, ranking, grouping, alignment, resizing or status field
anywhere in the result, and no place to put one. That is what lets one stored
observation outlive several generations of the policy reading it.

### Choosing your severity levels

`severityLevels` is required and has no default, because a level is a policy and
the library cannot know yours. Two ways to pick:

- **From a threshold you already run.** `YIQ_DISTANCE` performs the same
  arithmetic as `pixelmatch`, divided by its own maximum, so
  `severity === threshold²`. `yiqSeverityForThreshold(0.1)` returns `0.01`;
  `yiqThresholdForSeverity` goes back. The four levels in the sample are
  `pixelmatch` thresholds `0.05`, `0.1`, `0.2` and `0.4`. Playwright's
  `toHaveScreenshot({ threshold })` and `jest-image-snapshot` both run
  `pixelmatch`, so a curve can be quoted against a setting your team already
  argued about.
- **From a colour change you are about to make.** `severityBetweenColors` gives
  the severity two opaque colours differ by without rendering anything — a
  design token moving `#2d6cdf → #b5179e` is severity `0.153`, so you can put a
  level either side of it before the change lands.

Levels are sorted and de-duplicated for you; a negative or non-finite level
throws.

### Two boundaries worth knowing before you read a number

- `C(0)` is `1.0` for every field, including one taken from two identical
  images, because every pixel differs by at least nothing. If the question is
  "did anything change at all", `fieldStatistics(field).changedPixels` is the
  field that answers it — it counts `D > 0` strictly. `fieldStatistics` also
  returns `mean`, `maximum` and `totalPixels`.
- The unit's maximum is red against cyan. Black against white only reaches
  `0.933`, so a greyscale subject cannot produce a severity above that however
  wrong it is.

### Images that do not match

`observeDifference` refuses rather than adapting. Differing width or height,
`colorSpace` or `alphaMode` all throw `DifferenceFieldError` naming both sides,
and so does a `data` array whose length is not `width * height * 4`. A subject
that grew by a row is a finding, and compositing it onto a union box would
decide on your behalf that it was not one — align or resize upstream, where
something knows whether the movement was intended.

The one transform available is opt-in. `flattenOnto` names an opaque colour —
`observeDifference({ normalization: { flattenOnto: { red, green, blue } } })`
composites straight alpha onto it before measuring, and records
which colour it used in `normalization.parameters` so two observations flattened
differently refuse to compare.

### What the curve does not replace

`DiffPolicy` — the threshold-and-antialiasing pair the rest of the pipeline
compares under. It has two knobs: `threshold`, the per-pixel colour distance
above which a pixel counts as changed, and `includeAA`, whether antialiased
pixels count at all. The curve reproduces the first and cannot reproduce the
second: `pixelmatch` decides antialiasing from a neighbourhood of *both* images,
so it can treat two pixels carrying an identical difference value oppositely,
and no threshold on any per-pixel field gets there because the decision is not a
property of the pixel. Keep both — the field for how far a change reaches, the
policy for whether a renderer's antialiasing counts as a change at all.

## Decide whether a subject is worth photographing

`gateStability` takes documents of one subject that ought to be identical and
tells you whether to render. A `documentDigest` comes from
`@variance-authority/core/format`, over the same `RenderDocument` you would
render:

```js
// gate.mjs — node gate.mjs
import { documentDigest } from '@variance-authority/core/format';
import { gateStability, summarizeGate } from '@variance-authority/raster';

const document = {
  documentVersion: 1,
  subject: { id: 'ds/Badge:default', kind: 'story' },
  html: '<span class="badge">3 new</span>',
  frame: { html: {}, body: {}, ancestors: [{ tag: 'div', attributes: { class: 'app' } }] },
  css: ['.badge{padding:2px 6px;border-radius:9px}'],
  viewport: { width: 320, height: 120, deviceScaleFactor: 1 },
  inherited: { 'font-size': '14px' },
  fonts: ['Inter'],
  diagnostics: [],
};
// The second read of a subject that would not sit still.
const moved = { ...document, html: '<span class="badge">4 new</span>' };

console.log(documentDigest(document), documentDigest(moved));

const steady = gateStability([
  { documentDigest: documentDigest(document) },
  { documentDigest: documentDigest(document) },
]);
console.log(steady.state, steady.render, steady.because);

const restless = gateStability([
  { documentDigest: documentDigest(document) },
  { documentDigest: documentDigest(moved) },
]);
console.log(summarizeGate(restless));
```

```text
v1:c1fa2a124e02572a12b3e0cc12451d30 v1:454a38fc5a9715598090cdb2bb6776d3
stable true 2 documents of this subject are identical
[unstable] this subject was still changing when it was observed, so no image was taken.
Re-photographing it until two frames agree would hide this and cost every run;
the fix is in the component named below.
two documents of this subject at one commit disagree, so it was moving when it was observed and no image was taken. Supply snapshots to learn where
```

`state` has three values, not two. With no sample, or only one, you get
`unknown` — a single sample proves nothing, and printing it as stable would be a
verdict resting on a comparison nobody made. Nothing here retries and nothing
here renders an image.

Pass a `snapshot` alongside each digest and an unstable verdict carries an
`instability` naming the component and the property that moved, rather than only
saying that something did:

```js
gateStability([
  { documentDigest: firstDigest, snapshot: firstSnapshot },
  { documentDigest: secondDigest, snapshot: secondSnapshot },
]);
```

`SemanticSnapshot` is defined in `@variance-authority/core/format` and is
produced by whatever collected the page. Without one the gate can refuse to
render but cannot say what to fix.

## Contracts the rest of the pipeline is written against

These are types and small pure functions; the implementations live in the
packages named in the table above.

- **`assemble(document, { extraCss })`** — a `RenderDocument` becomes an HTML
  string, with no browser anywhere near it, so "would this document paint what
  was captured?" is a unit test. A `RenderDocument` is the captured subject
  subtree plus everything needed to repaint it: `html`, the applicable `css` in
  cascade order, the `frame` of ancestor tags the selectors need, the
  `inherited` values in force at the subject root, the `viewport`, and the
  `fonts` the capturing side saw loaded. `extraCss` is appended after
  everything else, so it is part of the assembled bytes and paints.
- **`Renderer`** — `identity`, `identityFor(document)`, `render(document)`,
  `close()`. `identityFor` is a method rather than something callers derive,
  because the key a baseline is stored under and the key it is looked up under
  have to be one value, and only the renderer knows how it will stamp one.
  `identityAtScale` is the shared implementation for renderers that vary only
  by device scale factor; `describeIdentity` renders an identity as the sentence
  a refusal prints.
- **`RasterStore`** — `find`, `describe`, `put`, optional `expect`. `describe`
  is the lookup answered without moving the image, which is how a run of three
  hundred subjects settles most of them from a few hundred bytes of sidecar
  instead of a few hundred megabytes of PNG. Every failure throws: a store that
  could not look must never be read as a store that found nothing. `identityFrom`
  and `recordFrom` are the checks a stored record passes before it is believed,
  wherever it arrived from. The CLI writes through this contract when you run
  `npx variance accept <subject>`, which promotes an image the run already
  produced and never re-renders.
- **`createEphemeralStore({ heldBytes })`** — returns a `RasterStore` with
  `retention: 'ephemeral'`. `find` and `describe` always return `null` and `put`
  keeps nothing: both images are rendered in the same run, by one renderer, and
  thrown away, so there is nothing to be comparable with. What it does keep,
  while the run is going, is the images it has already painted, so a subject
  read a second time is not painted twice. `heldBytes` bounds that at 64 MiB by
  default and evicts least-recently-used first; a miss costs a render.
- **`RenderCache`** — `get(digest, identity)` and `put(raster)`. Losing a
  baseline is fatal, losing a cache entry costs a render, so a `RenderCache`
  never throws. Wrap yours in `neverFails(cache)` at construction and that holds
  whatever it is built on.
- **`DiffPolicy`** — `{ id, threshold, includeAA }`. `DEFAULT_POLICY` is
  `threshold: 0.1, includeAA: false`, which forgives antialiasing and is what a
  real deployment runs, because text edges are otherwise permanently red.
  `STRICT_POLICY` is `threshold: 0, includeAA: true`. Report both and "zero
  pixels changed" can be told apart from "zero pixels changed *after
  forgiveness*". `RasterComparison` and `CompareOptions` are the shapes a
  comparator fills in: `policies` chooses which policies to count, `isolateWith`
  chooses whose `ChangeMask` — the per-pixel changed/unchanged bitmap — is
  returned for region isolation.
- **`settle(...)`** — the question asked before any pixel is paid for: given the
  baseline alone, does this subject need an image? Returns either
  `{ kind: 'settled', verdict: 'unchanged' | 'incomparable', because }` or
  `{ kind: 'render', because }`.
- **`defaultPlan(options)`, `DEFAULT_PLAN`, `defaultPlanIdentity(options)`** — a
  plan is the ordered list of tool declarations a pipeline runs, and its combined
  digest is the key everything the pipeline produces is stored under. Swap a
  tool and that digest moves, so a baseline made by the old arrangement is
  reported `incomparable` rather than compared and the difference blamed on a
  component. `defaultPlan` takes `policy` (which `DiffPolicy` the comparison
  step declares), `cell` (the grid size in pixels at which neighbouring changed
  pixels are counted as one place, default `8`, exported as `DEFAULT_CELL`), and
  `stabilization` (see below). `defaultPlanIdentity()` returns the digest
  directly; `defaultPlanIdentity({ cell: 16 })` returns a different one.

Stabilization recipes — the fixed sequence of tricks that holds a subject still
before capture, such as pausing animations and freezing carets — live in
`@variance-authority/core/format`, not here. An animation in flight moves
`transform`, which the document already carries, so the recipe changes what the
comparison sees at every stage rather than only at the image, and its digest is
part of the environment key that decides whether two captures are comparable at
all. What this package holds is
`defaultPlan({ stabilization })`, which folds that digest into the plan
identity, so retuning the tricks moves the key everything they produced is
stored under. [Hold a subject still](https://variance-authority.dev/docs/stabilization)
covers the recipes themselves.

## Two entrypoints, and why they are one package

`@variance-authority/raster` and `@variance-authority/raster/difference` import
nothing from each other. They ship together because they need the same thing
from you and nothing else: decoded pixels, or the contracts around them, with no
browser, codec, filesystem or socket in the dependency tree. Import the one you
need — `/difference` alone pulls in none of the store, renderer or plan code.

---

**[@variance-authority/raster](https://variance-authority.dev/reference/packages/raster)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
