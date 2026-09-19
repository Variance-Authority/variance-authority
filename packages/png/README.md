<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/png

> Decode, compare and diff PNGs without a browser: two buffers in, a mask out.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

You have two PNG files and you need to know what changed between them, in a form
you can act on. This package decodes both, compares them pixel by pixel, and
returns a **ChangeMask** — a per-pixel changed/unchanged bitmap, one byte per
pixel, set where that pixel differs — alongside a changed-pixel count.

A mask rather than a count, because *"5482 pixels changed"* cannot be assigned
to anyone. A mask rather than a rendered diff picture, because somebody then has
to open the picture and look. A count and a picture are both derivable from a
mask; neither can produce one. So this package stops at the mask — the last
artifact that still records pixel *positions* — and both of the other two are
available from it.

Turning those positions into named places (**region isolation**) and matching a
place to the component that produced it (**attribution**) are the next two steps,
and they are in `@variance-authority/core`. This package does not launch a
browser, store a baseline, or decide a pass/fail verdict.

Use `@variance-authority/raster` instead when a renderer already hands you
RGBA pixels, or when you want the comparison policy and storage contracts without
a codec.

## Requirements

Node 22 or newer. ESM only — these packages are `"type": "module"` and ship no
CommonJS build.

`pngjs` decodes and `pixelmatch` compares. Both are ordinary dependencies, so
there is nothing to choose and nothing native to build. The decoder accepts:

- every standard PNG colour type — greyscale, truecolour and palette, each with
  or without alpha
- bit depths 1 through 16; 16-bit channels are rescaled to 8 bits on decode
- interlaced (Adam7) images

Everything decodes to 8-bit RGBA, row-major, which is the one shape every
function here takes and returns. Alpha is a fourth channel like any other: two
images identical in RGB but differing in alpha are compared as changed.

Bytes that are not a valid PNG make `pngjs` throw a plain `Error` —
`unrecognised content at end of stream` for trailing garbage,
`There are some read requests waitng on finished stream` for a truncated file
(the typo is upstream). Nothing here catches it, so wrap the call if a corrupt
file should be a result rather than a crash.

`@variance-authority/raster` is a direct dependency of this package rather than a
peer, so it arrives either way — but the examples below import from it, so
declare it in your own manifest.

## Install

```bash
npm install --save-dev @variance-authority/png @variance-authority/raster
```

## Compare two PNGs

A **policy** is the pair of settings that decides whether a pixel counts as
changed: a colour-distance threshold, and whether antialiased pixels count. Two
are shipped and both are measured unless you say otherwise, so the first
comparison needs no configuration.

```ts
import { readFileSync } from 'node:fs';
import { comparePngs } from '@variance-authority/png';

const before = readFileSync('artifacts/before.png');
const after = readFileSync('artifacts/after.png');

const comparison = comparePngs(before, after);

console.log(comparison.changed.default, comparison.changed.strict);
console.log(comparison.mask.changed, 'of', comparison.total, 'pixels');
```

### What you get

A `RasterComparison`. This is the real value for a 20×20 white image compared
against the same image with a 5×5 black square painted into it:

```js
{
  width: 20,
  height: 20,
  dimensionsChanged: false,
  before: { width: 20, height: 20 },
  after: { width: 20, height: 20 },
  changed: { default: 25, strict: 25 },
  total: 400,
  mask: { width: 20, height: 20, changed: 25, data: Uint8Array(400) }
}
```

`changed` is an object keyed by policy `id`, one entry per policy compared —
neither a scalar nor an array. `total` is the pixel count of the canvas the two
were compared on. `mask.data` is `width * height` bytes, `1` where the pixel
differs, and `mask.changed` counts them under the single policy you isolated on.

That mask is what `isolateRegions` in `@variance-authority/core/attribute` takes
to group the changed pixels into rectangles.

## The two policies

| constant | `id` | `threshold` | `includeAA` | counts |
| --- | --- | --- | --- | --- |
| `DEFAULT_POLICY` | `default` | `0.1` | `false` | pixels past 10% YIQ colour distance, with antialiasing detected and forgiven |
| `STRICT_POLICY` | `strict` | `0` | `true` | any channel difference at all, antialiasing included |

`DEFAULT_POLICY` is the forgiving one. It is also what `pixelmatch` runs at out
of the box, which is what Playwright's `toHaveScreenshot` and jest-image-snapshot
report — so a number under `default` is comparable with a number from those
tools. Both policies are measured by default so that "zero pixels changed" can be
told apart from "zero pixels changed after antialiasing was forgiven".

A `DiffPolicy` is a plain object with those three fields, so define your own.
This is an excerpt — `before` and `after` are the buffers from the sample above:

```ts
import type { DiffPolicy } from '@variance-authority/raster';

const NEAR_EXACT: DiffPolicy = { id: 'near-exact', threshold: 0.02, includeAA: false };

const comparison = comparePngs(before, after, {
  policies: [NEAR_EXACT],
  isolateWith: NEAR_EXACT,
});
```

`policies` lists every policy counted into `changed`, and defaults to both
shipped constants. `isolateWith` picks which one of them the returned
`comparison.mask` belongs to, since exactly one mask comes back; it defaults to
`DEFAULT_POLICY`. Asking to isolate on a policy that is not in `policies` throws,
rather than returning a mask describing a different comparison from the counts
beside it.

## Mismatched sizes are padded

`pixelmatch` requires equal dimensions, and Playwright's `toHaveScreenshot` fails
outright when they differ. Here both images are copied onto the union box,
top-left aligned, `dimensionsChanged` is set, and `before` / `after` report the
original sizes — so a size change is measured rather than merely detected.

A 20×20 white image against a 20×21 copy with one black row added at the bottom:

```js
{
  width: 20,
  height: 21,
  dimensionsChanged: true,
  before: { width: 20, height: 20 },
  after: { width: 20, height: 21 },
  changed: { default: 20, strict: 20 },
  total: 420,
  mask: { width: 20, height: 21, changed: 20 }
}
```

Twenty pixels — the added row — rather than the whole image.

The padding is opaque **white**, and that is a position rather than a derived
value: white is taken as the page's assumed canvas. Transparent padding would
invent a difference wherever the shorter image's own background is opaque, which
is most captures. The cost lands on dark-themed UIs, where the padded strip reads
as changed against the darker image's own background and inflates the count by
the area of the strip. It is not configurable.

## The rest of the API

Three functions run the same comparison and differ only in what they accept.
`comparePngs` and `compareRasters` both end in `comparePixels`, so swapping how
the bytes arrive cannot change a verdict.

| export | signature |
| --- | --- |
| `comparePngs` | `(before: Buffer, after: Buffer, options?: CompareOptions) => RasterComparison` |
| `comparePixels` | `(left: DecodedImage, right: DecodedImage, options?: CompareOptions) => RasterComparison` |
| `compareRasters` | `(before: Raster, after: Raster, options?: CompareOptions & { decoder?: PngDecoder }) => Promise<RasterComparison>` |
| `diffImage` | `(before: Buffer, after: Buffer, policy?: DiffPolicy) => Buffer` |
| `pngSize` | `(bytes: Uint8Array) => { width, height } \| null` |
| `decode` | `(base64: string) => Buffer` |

`comparePixels` takes RGBA somebody else already decoded and does no decoding of
its own. A `DecodedImage` is `{ width, height, data }` where `data` is a `Buffer`
or `Uint8Array` of RGBA bytes — `pngjs`'s own `PNG` object satisfies it directly:

```ts
import { comparePixels } from '@variance-authority/png';

const comparison = comparePixels(
  { width: 1, height: 1, data: Buffer.from([255, 255, 255, 255]) },
  { width: 1, height: 1, data: Buffer.from([0, 0, 0, 255]) },
);

console.log(comparison.changed.default); // 1
```

`compareRasters` takes stored `Raster` records — base64 bytes plus render
identity, defined in `@variance-authority/core/format` — rather than loose
buffers, and decodes both concurrently through a swappable `PngDecoder`. That
seam is why it is the async one: decoding is about 90% of a comparison, and a
threadpool decoder makes a pair of images cost roughly what one costs. The
default decoder is `pngjs`, so this package still requires nothing native.

`diffImage` returns an encoded PNG — the after image dimmed with changed pixels
in red — for the person who does want to look. It is derived from the same bytes
and is not the comparison result.

`pngSize` reads the width and height out of the IHDR without decoding, and
returns `null` for bytes that are not a PNG or are too short for a header.
That is the cheap way to check whether two captures are even the same shape.

## PNG bytes this project did not paint

`foreignRaster(bytes, { painter, scale })` wraps an image from anywhere — another
tool, a design export, a device capture — as a `Raster` that can be compared.
`painter` is free text you choose and keep, such as `ios-simulator-17.4`: its
only job is to be the same string for images that are comparable and a different
string for images that are not. It is required rather than defaulted, because
nothing here can inspect the machine that produced the bytes, and a wrong
declaration makes two operators compare each other's screenshots.

The image's own bytes become its digest (`foreignDigest`), dimensions are read
from the image, and no component list is attached — `undefined` reads as
*unknown* downstream, where an empty array would read as *renders nothing*.

## `png/mask` — the same mask, without a codec

`@variance-authority/png/mask` exports the two functions that do the per-pixel
work, over raw RGBA. Take it when the pixels are already in hand: a canvas, a
framebuffer, `createImageBitmap` in a review page. A bundler following this
subpath never reaches `pngjs`.

```ts
import { differencePixels, padTo } from '@variance-authority/png/mask';
import { STRICT_POLICY } from '@variance-authority/raster';

// Two 2×2 RGBA images: white, and white with the first pixel painted black.
const left = { width: 2, height: 2, data: new Uint8Array(16).fill(0xff) };
const right = { width: 2, height: 2, data: Uint8Array.from(left.data) };
right.data.set([0, 0, 0, 255], 0);

const difference = differencePixels(left, right, STRICT_POLICY);
console.log(difference.changed); // 1
console.log(difference.width, difference.height); // 2 2

// `padTo` is the padding rule above, applied on its own.
const padded = padTo(left, 4, 4);
console.log(padded.width, padded.height); // 4 4
```

`differencePixels` returns `{ width, height, data, changed }`, where `data` is
RGBA. It pads to the union box itself, so `padTo` is only worth calling directly
when you need the padded pixels for something else. Pass
`{ diffMask: true }` as a fourth argument and it writes only the differing pixels
and leaves the rest transparent, which is how `comparePngs` gets a mask without
recovering one from a red-on-grey picture.

These are the same functions `comparePngs` runs, not a second implementation of
them, so a mask built here and a mask built from PNG bytes are the same mask.

## `png/difference` — how far apart two images are

Comparison asks whether a **subject** — one named UI state you asked for and can
ask for again — changed since its baseline. This entry point asks a different
question: by how much do two images differ, and how is that spread across the
image. Use it when the two images are *expected* to differ — two browser engines
rendering the same page — and what you are tracking is whether the gap is
growing.

```ts
import { readFileSync } from 'node:fs';
import { observePngDifference } from '@variance-authority/png/difference';
import { YIQ_DISTANCE } from '@variance-authority/raster/difference';

const observation = await observePngDifference({
  firstImage: readFileSync('artifacts/chromium.png'),
  secondImage: readFileSync('artifacts/webkit.png'),
  metric: YIQ_DISTANCE,
  severityLevels: [0, 0.01, 0.04, 0.16, 0.64],
});

console.log(observation.curve);
```

You get a **difference field** — one magnitude per pixel, 0 to 1 under
`YIQ_DISTANCE` — and a **severity curve**: for each threshold in
`severityLevels`, how many pixels differ by at least that much, and what fraction
of the image that is.

### What you get

The real observation for the same 20×20 pair as above — white, against white with
a 5×5 black square:

```js
{
  formatVersion: 'variance-difference/1',
  metric: {
    name: 'yiq-distance',
    version: '1',
    parameters: { alphaBackground: 'white' },
    unit: 'yiq-normalized',
    range: { minimum: 0, maximum: 1 }
  },
  image: { width: 20, height: 20, colorSpace: 'srgb', alphaMode: 'opaque' },
  normalization: { version: '1', parameters: { flattenOnto: 'none' } },
  field: { width: 20, height: 20, values: Float32Array(400) },
  curve: [
    { severity: 0,    pixelCount: 400, imageRatio: 1 },
    { severity: 0.01, pixelCount: 25,  imageRatio: 0.0625 },
    { severity: 0.04, pixelCount: 25,  imageRatio: 0.0625 },
    { severity: 0.16, pixelCount: 25,  imageRatio: 0.0625 },
    { severity: 0.64, pixelCount: 25,  imageRatio: 0.0625 }
  ],
  sourceHashes: {
    firstImage: 'v1:8809443ab6a902672b3334aa48002838',
    secondImage: 'v1:8548cfff610f464d591e659caa0c68a6'
  }
}
```

`severity: 0` counts every pixel, since every measured pixel differs by at least
zero. `alphaMode` is reported as `opaque` when no pixel has a non-opaque
alpha and `straight` otherwise, because that distinction changes what the metric
does. `colorSpace` is declared and defaults to `'srgb'`; nothing is resampled or
colour-managed, since a conversion performed here would be a difference this
package invented. Source hashes are taken over the **encoded** bytes rather than
the decoded pixels, because that is what you have and can look up again.

`observePngDifference` is async because a `DifferenceMetric` may be a native
module, a worker or a remote service. `YIQ_DISTANCE` is arithmetic over two
arrays, and `measureYiqDistance` in `@variance-authority/raster/difference` is
its synchronous form. `comparePngs` has no such seam, which is why it is sync.

### Different sizes throw here

Where comparison pads, this refuses, with a `DifferenceFieldError`:

```
images are 20×20 and 20×21. This library does not resize, pad or align: a size
change is a measurement, not a nuisance. Composite them upstream if that is
what you meant.
```

A baseline field measured on one grid has no per-pixel correspondence with a
current field measured on another, so padding would invent a difference across
the whole added region and then report it as drift. Composite the images to a
common size yourself if that is what you meant.

Neither entry point can recover component ownership from PNG bytes. A mask that
needs an owner gets one from `@variance-authority/core`, which takes the mask and
the component information captured at render time.

---

**[@variance-authority/png](https://variance-authority.dev/reference/packages/png)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
