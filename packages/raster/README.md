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
| [`@variance-authority/observe`](../observe) | the three above, which it composes |

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

## Reading

- [`docs/architecture.md`](../../docs/architecture.md) — the composition model
- [ADR-0011](../../docs/context/adr/0011-durable-and-ephemeral-retention.md) — the two retention modes
- [ADR-0012](../../docs/context/adr/0012-observability-and-the-damage-boundary.md) — what testability is allowed to cost
