# Reviewing `@variance-authority/raster`

The contracts around a picture, with no browser, codec, disk or socket: what
a render document assembles to, what a `Renderer` and a `RasterStore`
promise, whether a baseline settles a subject without an image, the plan
identity, and, under `/difference`, a measured difference between two decoded
images. `png`, `playwright`, `store`, `remote` and `observe` implement or call
it.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/raster/`.

## Contracts

- **A store that could not look never reads as one that found nothing.**
  Every `RasterStore` failure throws; a `RenderCache` never throws, and a
  failed lookup is a miss. Written in the
  [README](README.md#contracts-the-rest-of-the-pipeline-is-written-against)
  and pinned by [`src/store.test.ts`](src/store.test.ts) › "answers a failed
  lookup as a miss, because the response to both is to paint".
- **`settle` says `unchanged` only for the exact document and machine.**
  Another machine, an older or unrecorded recipe, an unstated identity, a
  moved document or no baseline renders and names what moved. Pinned by
  [`src/settle.test.ts`](src/settle.test.ts) › "settles `unchanged` when the
  baseline was painted from this exact document" and "renders when the caller
  did not say what this run paints under".
- **The ephemeral store has no past.** `find` and `describe` answer `null`,
  and a held image is served only for the digest and machine that painted it.
  Pinned by [`src/store.test.ts`](src/store.test.ts) › "has no past, so it
  never claims one" and "does not serve one machine`s render to another".
- **One sample is `unknown`, never stable, and the gate never retries.**
  Written in the
  [README](README.md#decide-whether-a-subject-is-worth-photographing) and
  pinned by [`src/gate.test.ts`](src/gate.test.ts) › "reports one sample as
  unchecked, not as stable" and "never asks for a third sample".
- **Changing the system changes the address.** Policy, `cell` and the
  stabilization digest each move the plan identity; an unchanged composition
  holds it. Pinned by [`src/plan.test.ts`](src/plan.test.ts) › "moves when the
  tricks applied to the page change" and "holds for an unchanged composition".
- **A difference is measured, never adapted.** Mismatched sizes, colour
  spaces or alpha modes throw; a field value is finite and non-negative, and
  `0` means measured and equal. Written in the
  [README](README.md#images-that-do-not-match) and pinned by
  [`src/difference/difference.test.ts`](src/difference/difference.test.ts) ›
  "refuses images of different sizes rather than padding them" and "rejects a
  non-finite value, because NaN >= t is false at every level".
- **The default policy counts a colour change above 1%.** Written in the
  [README](README.md#contracts-the-rest-of-the-pipeline-is-written-against).

## Where to look for a counterexample

- `assemble.ts`: the frame a kept rule needs, the parent's own width, a
  layered body's padding, the inherited floor losing to every root rule.
- `codec.ts`: a sidecar field it cannot parse is dropped, never invented, and
  a digest it cannot parse still refuses the baseline.
- `ephemeral.ts`: the `heldBytes` ceiling must count a hit as use and keep
  an image larger than the whole ceiling rather than refuse the run.
