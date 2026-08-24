<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/raster

**Requires:** nothing. No browser to launch, no directory to write, no port to
bind, no runtime globals — the same `types: []` bar `core` clears.

What is left when those are taken away turns out to be most of the interesting
part: what a document assembles to, what a renderer promises, what a store
promises, which policy a comparison ran under, which tricks a subject was held
still with, whether it held still at all, and what the composition that produced
an answer was.

## Use this package when

Install `@variance-authority/raster` when a caller already has decoded pixels or
needs the contracts around rendering, storage, plans, and stability. It does not
decode PNGs, launch a browser, write a baseline, or choose a test runner. Use
[`@variance-authority/png`](../png) for PNG bytes and pass a `ChangeMask` here
when the next step is region isolation or attribution.

## Package boundary

| package | requires |
|---|---|
| [`@variance-authority/png`](../png) | a PNG codec |
| [`@variance-authority/playwright`](../playwright) | a browser |
| [`@variance-authority/store`](../store) | a filesystem |
| [`@variance-authority/remote`](../remote) | a socket |
| [`@variance-authority/observe`](../observe) | a PNG codec — it composes `png` with `core` and this package, and nothing else in this table |

Nothing here imports any of them. A team extending their own Playwright tests
needs this vocabulary without a second browser; a team keeping baselines
somewhere this project has never heard of needs the store contract without a
disk.

The ephemeral retention mode lives here for the same reason, and it is the
clearest case: *"no container, no pinned runner, no stored artifact"* stops being
a claim in a comment when the mode's package pulls in no filesystem and no
socket.

## What it holds

- **`assemble`** — a `RenderDocument` becomes an HTML string. Pure text.
- **`Renderer`** — the contract every renderer satisfies, local or two networks
  away, plus `identityFor` (the lookup key and the write key must be one value).
- **`RasterStore`** — the contract every backend satisfies, plus the in-memory
  store and the checks a stored record passes before it is believed, wherever it
  arrived from. A store failure is never a verdict: every one of them throws.
- **`RenderCache`** — a store's sibling, kept separate because
  the two have opposite loss semantics. Losing a baseline is fatal; losing a cache
  entry costs a render, so **a `RenderCache` never throws** and `neverFails` holds
  an implementation to that at construction.
- **`DiffPolicy`** — `DEFAULT_POLICY` and `STRICT_POLICY`. A threshold and an
  antialiasing rule decide verdicts and belong in a plan's identity, and none of
  that requires the ability to decode a PNG.
- **The stability gate** — two cheap documents compared. Never a third sample.
- **The default plan** — the shipped composition, declared.

## Interventions are not here

They are in [`@variance-authority/core/format`](../core), and that is a claim
about what they are rather than tidying. Holding a page still looks like something
you do before you photograph it, but an animation in flight moves `transform`,
which the *cheap* representation carries. A stabilization recipe is a render input
on every tier, its digest is a field of `EnvironmentInputs`, and it belongs beside
the key it is part of. See
[`docs/stabilization.md`](../../docs/stabilization.md).

What is still here is the plan that names one:
`defaultPlan({ stabilization })` folds `recipeDigest` into the plan identity, so
retuning the tricks moves the address of everything they produced.

## Stability gate

```ts
import { gateStability } from '@variance-authority/raster';

const verdict = gateStability([
  { documentDigest: 'v1:before' },
  { documentDigest: 'v1:after' },
]);
console.log(verdict.state, verdict.render); // unstable false
```

Two different document digests return `unstable` with `render: false`; equal
digests return `stable` with `render: true`. With no sample, or only one, the
gate returns `unknown` rather than treating an unchecked subject as stable.
The gate does not retry or render an image.

The other controls stay at the seams where they affect identity or measurement:

| call | useful controls |
|---|---|
| `defaultPlan` | `policy` selects the `DiffPolicy`, `cell` chooses the region grid, and `stabilization` folds the applied recipe into the plan identity |
| `assemble` | `extraCss` adds caller-owned CSS to a render document; it is part of the assembled bytes and therefore its digest |
| raster comparison | `policies` chooses which `DiffPolicy` values to count and `isolateWith` chooses the policy whose mask is returned |
| `observeDifference` | `flattenOnto` is the explicit background for straight-alpha images; no colour conversion, resize, or alignment is implied |

The usual instability check shoots, waits, shoots again, and keeps going until
two frames agree. It is slow by construction and destroys the finding when it
succeeds. One disagreement is the answer; a third sample could only say how
often, which is not the question.

## `raster/difference` — measuring a difference that was never zero

A second entrypoint, and a different question. Everything above compares an image
against what it is supposed to be. `@variance-authority/raster/difference`
measures the difference between two images that are *not* supposed to match, and
then measures how that difference moved:

```ts
import {
  YIQ_DISTANCE,
  observeDifference,
  compareDifferenceObservations,
  type NormalizedImage,
} from '@variance-authority/raster/difference';

const chromiumPixels: NormalizedImage = {
  width: 1,
  height: 1,
  data: new Uint8Array([255, 0, 0, 255]),
  colorSpace: 'srgb',
  alphaMode: 'opaque',
};
const webkitPixels: NormalizedImage = {
  ...chromiumPixels,
  data: new Uint8Array([0, 0, 255, 255]),
};
const baseline = await observeDifference({
  firstImage: chromiumPixels,
  secondImage: webkitPixels,
  metric: YIQ_DISTANCE,
  severityLevels: [0, 0.01, 0.04, 0.16, 0.64],
});

const current = await observeDifference({
  firstImage: chromiumPixels,
  secondImage: chromiumPixels,
  metric: YIQ_DISTANCE,
  severityLevels: [0, 0.01, 0.04, 0.16, 0.64],
});
const comparison = compareDifferenceObservations(baseline, current);
comparison.curveDelta;  // how much more of the image differs, at each severity
comparison.fieldDelta;  // and where, per pixel
```

The result is a difference field and severity curve; `compareDifferenceObservations`
returns their movement between the two observations. The images must already
share dimensions, colour space, and alpha mode. This entrypoint does not resize,
decode, align, or decide whether a movement is acceptable; those choices belong
to the caller and to the PNG or policy packages.

Two renderers that never agreed, a font stack that was always slightly off, a
compression pass that always softened an edge — none has to be eliminated before
it can be watched, because the quantity under observation is the disagreement
rather than either side of it.

**It keeps severity and amount apart.** A pixel count collapses them, and the
result is dominated by area — which is how a one-pixel spacing change reports
thousands of differing pixels and means nothing by it. `C(t)` is the proportion
of the image differing at severity `t` or above, so a broad weak change and a
small severe one stop looking alike.

**It decides nothing.** No verdict, no threshold, no ranking, no grouping, no
alignment, no resizing. The result type has no status field and there is nowhere
to put one — which is what lets one stored observation outlive several
generations of the policy reading it.

**Its severities are readable against a threshold you already run.**
`YIQ_DISTANCE` is the arithmetic `pixelmatch` performs divided by its own
maximum, so `severity === threshold²`: `DEFAULT_POLICY` is severity `0.01` and
`STRICT_POLICY` is anything above `0`.

Two boundaries matter when reading the field:

- `C(0)` is `1.0` for every field, including one from two identical images —
  every pixel differs by at least nothing. `fieldStatistics().changedPixels`
  is the question people mean.
- The unit's maximum is red against cyan, **not** black against white, which
  only reaches `0.933`. A greyscale subject cannot produce a severity above that
  however wrong it is.

**What the curve does not subsume** is `DiffPolicy`. That policy moves two knobs,
and antialiasing forgiveness is not the one on the severity axis: `pixelmatch`
decides it from a neighbourhood of *both* images, so it can treat two pixels
carrying an identical difference value oppositely. No threshold on any per-pixel
field reproduces that, and
field reproduces that.

## Reading

- [`docs/architecture.md`](../../docs/architecture.md) — the composition model
- [ADR-0011](../../docs/context/adr/0011-durable-and-ephemeral-retention.md) — the two retention modes
- [ADR-0012](../../docs/context/adr/0012-observability-and-the-damage-boundary.md) — what testability is allowed to cost
