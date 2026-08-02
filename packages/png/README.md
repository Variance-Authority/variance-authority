# @variance-authority/png

**Requires:** a runtime with `Buffer` — so Node, not a browser. Nothing to launch,
nothing to write, nothing to reach. Two buffers in, a mask out.

This is a package rather than a folder so that **comparing two images never costs
you a browser**. A team extending their own Playwright tests takes comparison,
isolation and attribution and renders nothing; a team whose images arrive from
elsewhere takes only the reading end. Neither should have to launch Chromium to
do it, and with the codec boxed on its own neither does.

## It stops at a mask

```ts
import { compareRasters, decode, diffImage } from '@variance-authority/png';
import { DEFAULT_POLICY, STRICT_POLICY } from '@variance-authority/raster';

const comparison = compareRasters(before, after, {
  policies: [DEFAULT_POLICY, STRICT_POLICY],
  isolateWith: DEFAULT_POLICY,
});

comparison.changed;   // { default: 86, strict: 1530 }
comparison.mask;      // positions — what isolation and attribution need
```

Not a number, and not a picture. The number is what makes a pixel differ
unactionable — *"5482 pixels changed"* cannot be assigned to anyone — and the
picture is what makes it expensive, because somebody has to look. Both are
derivable from a mask; neither can produce one.

So this phase stops at the last artifact that still has **positions** in it, and
the phases that turn positions into places and places into files come after, in
[`core/attribute`](../core).

## The policy is not here

A threshold and an antialiasing rule decide verdicts and belong in a plan's
identity, so they live in [`@variance-authority/raster`](../raster) where a caller
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
canvas is white, and the padding is reported. A story that grew by one row then
differs in that row rather than in its entire area.

## `png/difference` — the codec half of known-difference measurement

```ts
import { observePngDifference } from '@variance-authority/png/difference';
import { YIQ_DISTANCE } from '@variance-authority/raster/difference';

const observation = await observePngDifference({
  firstImage: chromiumPng,
  secondImage: webkitPng,
  metric: YIQ_DISTANCE,
  severityLevels: [0, 0.01, 0.04, 0.16, 0.64],
});
```

Decoding is the only part that needs a decoder, so it is the only part here. The
field, the curve, the deltas and the artifact are arithmetic over two arrays and
live in [`@variance-authority/raster/difference`](../raster) — which means a team
whose images arrive as raw RGBA, from a canvas or a WASM renderer or a
framebuffer, never installs this package at all.

Source hashes are taken over the **encoded** bytes rather than the decoded
pixels, because that is what a caller has and can look up again.

### It refuses mismatched sizes, and the section above does not

A real divergence, stated rather than smoothed over. `compareRasters` pads,
because it is answering *did this subject change* and refusing would let a layout
change score "detected" without measuring anything. `observePngDifference`
refuses, because it is answering *how has a known difference moved* — and a
baseline field measured on one grid has no per-pixel correspondence with a
current field measured on another. Padding there would silently invent a
difference across the whole added region and then report it as drift.

Both are right for their question. Neither should be quietly given the other's
behaviour.
