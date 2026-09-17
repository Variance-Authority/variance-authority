<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/png

> Decode, compare and diff PNGs without a browser: two buffers in, a mask out.

Part of [Variance Authority](https://variance-authority.dev), a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source.

This package needs a PNG codec and a runtime with `Buffer` — so Node, not a
browser — and nothing else: nothing to launch, nothing to write, nothing to
reach. It decodes two images, compares them, and returns a
`ChangeMask` — a per-pixel changed/unchanged bitmap, one byte per pixel, set
where that pixel differs. Grouping those pixels into named places
(**region isolation**) and matching a place to the component that produced it
(**attribution**) are the next two steps; both live one layer up, in
`@variance-authority/core`.

## Install

```bash
npm install --save-dev @variance-authority/png
```

## Use this package when

Use `@variance-authority/png` when the inputs are PNG bytes. Use
`@variance-authority/raster` instead when a renderer already gives you RGBA
pixels, or when you need the policy and storage contracts without a codec.
This package does not launch a browser, store a baseline, or decide a
pass/fail verdict.

## Smallest working path

```ts
import { readFileSync } from 'node:fs';
import { comparePngs, diffImage } from '@variance-authority/png';
import { DEFAULT_POLICY, STRICT_POLICY } from '@variance-authority/raster';

const before = readFileSync('artifacts/before.png');
const after = readFileSync('artifacts/after.png');
const comparison = comparePngs(before, after, {
  policies: [DEFAULT_POLICY, STRICT_POLICY],
  isolateWith: DEFAULT_POLICY,
});

console.log(comparison.changed, comparison.mask.changed);

// The picture, for when somebody does have to look. On request, never by default.
const picture = diffImage(before, after, DEFAULT_POLICY);
```

Not a number, and not a picture. The number is why a pixel differ is
unactionable — *"5482 pixels changed"* cannot be assigned to anyone — and the
picture is why it is expensive, because somebody has to look. Both are
derivable from a mask; neither can produce one.

`comparison.changed` contains one count per requested policy and `mask` keeps
the changed positions for region isolation. `diffImage` is an optional encoded
PNG for a human review; it is derived from the same bytes and is not the
comparison result. If the caller already has decoded RGBA, `comparePixels`
avoids a second decode.

So this phase stops at the last artifact that still has **positions** in it, and
the phases that turn positions into places and places into files — region
isolation, then attribution — come after, in `@variance-authority/core`.

## The policy is not here

A threshold and an antialiasing rule decide verdicts and belong in a plan's
identity, so they live in `@variance-authority/raster` where a caller
who never opens a PNG can read, compare and hash them.

**Both policies are reported by default**, and that is a fairness rule rather
than a feature: quoting only the forgiving one is the single most common way to
lie with a pixel measurement, because "zero pixels changed" and "zero pixels
changed *after forgiveness*" are different sentences.

`pixelmatch` runs at its own defaults. It is the differ behind most of the
ecosystem — Playwright's `toHaveScreenshot`, jest-image-snapshot — and tuning it
to flatter this project would make every comparison against a pixel tool
worthless.

## Mismatched sizes are padded, not refused

`pixelmatch` requires equal dimensions and Playwright's own `toHaveScreenshot`
simply fails when they differ. Failing is the easy choice and the dishonest one:
it lets a layout change score "detected" without measuring anything.

Both images are padded onto the union box, on **white** because a page's declared
canvas is white, and the padding is reported. A story that grew by one row differs
in that row rather than in its entire area.

## `png/mask` — the same mask, without a decoder

Nothing in the per-pixel work needs a codec. `@variance-authority/png/mask`
exports the two pieces that do the work — `padTo`, the padding rule above, and
`differencePixels`, the diff itself — over raw RGBA:

```ts
import { differencePixels, padTo } from '@variance-authority/png/mask';

const difference = differencePixels(padTo(before, width, height), padTo(after, width, height));
```

Take it when the pixels are already in hand: a canvas, a framebuffer,
`createImageBitmap` in a review page. It exists because the mask is now computed
in two places — here when a run writes its report, and in a browser when a
reviewer opens a change whose mask was never uploaded — and two ends computing
the same thing is only safe while it is literally the same code. A reviewer must
never be shown a mask the verdict was not made from.

## `png/difference` — the codec half of known-difference measurement

```ts
import { observePngDifference } from '@variance-authority/png/difference';
import { YIQ_DISTANCE } from '@variance-authority/raster/difference';
import { readFileSync } from 'node:fs';

const observation = await observePngDifference({
  firstImage: readFileSync('artifacts/chromium.png'),
  secondImage: readFileSync('artifacts/webkit.png'),
  metric: YIQ_DISTANCE,
  severityLevels: [0, 0.01, 0.04, 0.16, 0.64],
});
```

Decoding is the only part that needs a decoder, so it is the only part here.
`observePngDifference` returns a **difference field** — one magnitude, 0 to 1,
per pixel — and a **severity curve**: for each threshold in `severityLevels`
(the bands the curve is sampled at), the fraction of the image differing by at
least that much. Both are arithmetic over two pixel arrays and live in
`@variance-authority/raster/difference` — which means a team whose images
arrive as raw RGBA, from a canvas or a WASM renderer or a framebuffer, never
installs this package at all.

Source hashes are taken over the **encoded** bytes rather than the decoded
pixels, because that is what a caller has and can look up again.

### It refuses mismatched sizes, and the section above does not

A real divergence, stated rather than smoothed over. `compareRasters` pads,
because it is answering *did this subject — the newly rendered image — change*
and refusing would let a layout change score "detected" without measuring
anything. `observePngDifference` refuses, because it is answering *how has a
known difference drifted* — and a baseline field measured on one grid has no
per-pixel correspondence with a current field measured on another. Padding
there would silently invent a difference across the whole added region and
then report it as drift.

Both are right for their question. Neither should be quietly given the other's
behaviour.

The first example pads different dimensions onto a white union canvas and sets
`dimensionsChanged`. The difference entrypoint refuses different dimensions,
because its per-pixel correspondence would otherwise be fabricated. Neither
path can recover component ownership from PNG bytes; supply that through the
capture or attribution tiers when a mask needs an owner.

---

**[@variance-authority/png](https://variance-authority.dev/reference/packages/png)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
