# @variance-authority/raster

**Requires:** nothing. No browser to launch, no directory to write, no port to
bind, no runtime globals — the same `types: []` bar `core` clears.

What is left when those are taken away turns out to be most of the interesting
part: what a document assembles to, what a renderer promises, what a store
promises, which policy a comparison ran under, which tricks a subject was held
still with, whether it held still at all, and what the composition that produced
an answer was.

## Why this is separate from the things it describes

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
  store, `renderCached`, and the checks a stored record passes before it is
  believed, wherever it arrived from.
- **`DiffPolicy`** — `DEFAULT_POLICY` and `STRICT_POLICY`. A threshold and an
  antialiasing rule decide verdicts and belong in a plan's identity, and none of
  that requires the ability to decode a PNG.
- **Interventions** — an open registry of tricks, each declaring what it governs,
  the cheapest tier that can observe its effect, and why it is worth the damage.
- **The stability gate** — two cheap documents compared. Never a third sample.
- **The default plan** — the shipped composition, declared.

## Interventions are a registry, not a stage

```ts
import { RASTER_RECIPE, forTier, conflicts, recipeCss, recipeDigest } from '@variance-authority/raster';

forTier(RASTER_RECIPE, 'semantic');   // [] — an unloaded font cannot change which rules match
conflicts(RASTER_RECIPE);             // two tricks over one property: reported, never resolved
recipeDigest(RASTER_RECIPE);          // folds into the plan identity, so retuning moves the address
```

Two tricks governing one property is a **conflict to report**, not a precedence
rule to invent.

## The gate refuses rather than retries

```ts
import { gateStability } from '@variance-authority/raster';

const verdict = gateStability([first, second]);
// { state: 'unstable', render: false, because: 'Spinner will not hold still at `transform`' }
```

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
} from '@variance-authority/raster/difference';

const baseline = await observeDifference({
  firstImage: chromiumPixels,
  secondImage: webkitPixels,
  metric: YIQ_DISTANCE,
  severityLevels: [0, 0.01, 0.04, 0.16, 0.64],
});

const comparison = compareDifferenceObservations(baseline, current);
comparison.curveDelta;  // how much more of the image differs, at each severity
comparison.fieldDelta;  // and where, per pixel
```

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
`STRICT_POLICY` is anything above `0`. The equivalence is asserted against
`pixelmatch` itself, not claimed.

Two things that surprise people, both pinned by tests:

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
[`png/src/difference.test.ts`](../png/src/difference.test.ts) constructs the case
that proves it.

## Reading

- [`docs/architecture.md`](../../docs/architecture.md) — the composition model
- [ADR-0011](../../docs/context/adr/0011-durable-and-ephemeral-retention.md) — the two retention modes
- [ADR-0012](../../docs/context/adr/0012-observability-and-the-damage-boundary.md) — what testability is allowed to cost
