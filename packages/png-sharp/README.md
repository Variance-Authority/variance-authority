<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/png-sharp

> Faster PNG decoding for Variance Authority through sharp, for runtimes that can load a native addon.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

Comparing two screenshots costs almost nothing once the pixels are in memory.
Getting them there costs almost everything: decoding is about 90% of a raster
comparison, and `pixelmatch` is 9% of it. This package replaces the decoding
step with libvips, through `sharp`.

`@variance-authority/png` decodes with `pngjs` — synchronous JavaScript on the
main thread, no native code, runs wherever Node does. `sharpDecoder` decodes on
libuv's threadpool instead, so images decoded concurrently leave the main thread
entirely. That is the whole difference: same comparison, same verdict, less time
in the decode.

Both decoders produce byte-identical RGBA, so swapping one for the other changes
what a run *costs* and never what it *decides*.

You do not need this package to use the CLI — `@variance-authority/cli` already
depends on it, so `npm install --save-dev @variance-authority/cli` installs
`sharp` too. Install it yourself when you call the comparison library directly
and want the faster decode.

## Requirements

| Requirement | Value |
| --- | --- |
| Node | 22 or newer |
| Module format | ESM only — this package has no CommonJS build |
| `sharp` | `^0.34.4`, a direct dependency: you do not install it separately |

`sharp` is a **native addon** — a compiled, platform-specific `.node` file
loaded into the process. It arrives as a prebuilt binary that your package
manager downloads; there is no compiler step and no postinstall script. What
that costs you:

- Binaries exist for macOS on arm64 and x64, Linux on x64 and arm64 against both
  glibc and musl, and Windows on x64 and arm64. Alpine and other musl images are
  covered, so the usual musl failure — an addon resolving to a glibc binary and
  dying at load — does not apply here.
- The libvips binary is roughly 15 MB on macOS arm64. Your package manager
  unpacks one platform's binary, not the matrix.
- The binary is chosen for the platform that ran the install. Building
  `node_modules` on one platform and shipping the directory to another — a
  Lambda bundle or a container image assembled on a developer machine — gives
  you a binary that will not load there. Install on the target platform, or in
  an image built for it.
- A runtime that cannot load a `.node` file at all — a Cloudflare Worker, an
  edge runtime, a bundle that cannot contain one — cannot use this package. Use
  `@variance-authority/png` alone there; it needs only `Buffer`.

[Native code](https://variance-authority.dev/docs/native-code) has the full
picture, including what a CI image needs.

## Compare two images with it

```sh
npm install @variance-authority/png @variance-authority/png-sharp sharp
```

The example below imports `sharp` directly to generate its two inputs, which is
why it is on the install line; `png-sharp` already depends on it. Save this as
`compare.mjs` and run `node compare.mjs`:

```js
import sharp from 'sharp';
import { compareRasters, foreignRaster } from '@variance-authority/png';
import { sharpDecoder } from '@variance-authority/png-sharp';

const WIDTH = 1280;
const HEIGHT = 800;

// Two page-like images that differ by one 60×40 block, moved 20px right.
function png(moved) {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4, 0xff);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const i = (y * WIDTH + x) * 4;
      const inBlock = y >= 300 && y < 340 && x >= (moved ? 520 : 500) && x < (moved ? 580 : 560);
      const v = inBlock ? 40 : 250 - (x >> 7);
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return sharp(rgba, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toBuffer();
}

// A raster is image bytes plus the identity of whatever painted them. This
// process did not paint these, so you declare that identity yourself; two
// images are only comparable when they carry the same declaration.
const painter = { painter: 'chromium@131' };
const before = foreignRaster(await png(false), painter);
const after = foreignRaster(await png(true), painter);

const comparison = await compareRasters(before, after, { decoder: sharpDecoder });

console.log({
  width: comparison.width,
  height: comparison.height,
  dimensionsChanged: comparison.dimensionsChanged,
  changed: comparison.changed,
  total: comparison.total,
  mask: {
    width: comparison.mask.width,
    height: comparison.mask.height,
    changed: comparison.mask.changed,
  },
});
```

Replace the two generated buffers with `readFileSync('before.png')` and
`readFileSync('after.png')` to compare your own screenshots.

### What you get

```
{
  width: 1280,
  height: 800,
  dimensionsChanged: false,
  changed: { default: 1600, strict: 1600 },
  total: 1024000,
  mask: { width: 1280, height: 800, changed: 1600 }
}
```

`changed` is counted once per policy: `default` forgives antialiasing and a
0.1 channel threshold, `strict` forgives nothing. Both are reported so that
"zero pixels changed" can be told apart from "zero pixels changed after
forgiveness". `total` is the pixels on the compared canvas — the union of the
two boxes, so a size change is a difference in the padded rows rather than a
refusal to compare. `mask.data` (omitted above, it is 1,024,000 bytes) is one
byte per pixel, `1` where the pixel differs.

Drop `{ decoder: sharpDecoder }` and the same call decodes with `pngjs` and
prints the same numbers. `sharpDecoder.decode(bytes)` is the lower seam, when
you want a decoded image for `comparePixels` yourself.

## How much faster

One machine's figures, from the benchmark script shipped in the package: 32
images at 1280×800, ~283 KiB each, one process, on an Apple M4 Max under Node
26.7, sharp 0.34.5, libvips 8.17.3.

| Decode | Per image |
| --- | --- |
| `sharpDecoder`, `Promise.all`, threadpool of 4 (the default) | 0.9 ms |
| `sharpDecoder`, one at a time | 2.7 ms |
| `pngjs`, one at a time | 6.0 ms |

The per-image constant is a little over 2×. The rest is the threadpool: under
`Promise.all` the decodes run off the event loop, which `pngjs` cannot do at
all. `compareRasters` decodes its pair concurrently for exactly this reason, so
a pair costs about what one image costs.

Reproduce it on the machine you care about, because addon load, image shape,
concurrency and pool size all change the result:

```sh
node node_modules/@variance-authority/png-sharp/scripts/bench.mjs
UV_THREADPOOL_SIZE=12 node node_modules/@variance-authority/png-sharp/scripts/bench.mjs
```

The script generates its inputs and checks every decoded RGBA buffer against
`pngjs` before it reports a time. Raising the pool to 12 bought 0.9 ms → 0.8 ms
on the machine above: four libvips threads already saturate a decode this cheap.
libuv reads `UV_THREADPOOL_SIZE` once, before the pool is first used, so it has
to be set in the environment — this package cannot set it for you.

## With the CLI

`npx variance run` picks the decoder for you. The top-level `decoder` key in
your config takes three values:

- **`auto`** (the default) loads this package and silently keeps `pngjs` when
  the load fails — which is what happens on a platform `sharp` publishes no
  binary for. A machine without the binary produces the same verdicts more
  slowly, never no verdicts.
- **`pngjs`** pins the portable decoder, so a run cannot get faster or slower
  because a machine happened to have a binary.
- **`sharp`** fails the run when the addon will not load. Set it on a build
  machine, where a missing binary should be an error rather than an
  unexplained slowdown six months later.

```json
{
  "decoder": "auto"
}
```

The failure `auto` catches is at load time: `sharp` throws when it cannot
resolve an addon for the platform, so importing this package throws, and the CLI
falls back there. Under `decoder: "sharp"` that same failure is reported with
the resolution error attached.

## The two decoders produce the same pixels

A run may pick either decoder depending on what a machine can load, so both must
produce byte-identical RGBA. One byte of disagreement would make a subject — one
named UI state you asked for and can ask for again — `changed` on a laptop and
`unchanged` in CI, with nothing in either report to explain it.

The parity suite lives in this package, because this is the package that adds a
second decoder. It asserts bytes rather than verdicts: two decoders can agree on
a verdict while both losing the same information. It covers flat colour, a
gradient that exercises every PNG filter type, partial transparency, fully
transparent pixels whose colour must survive a premultiplying decoder, a
one-pixel image, and the padding a size mismatch forces.

`sharpDecoder` calls `ensureAlpha()` for the same reason: a PNG saved without an
alpha channel decodes to 3 bytes per pixel, `pixelmatch` reads 4, and
three-channel data does not throw — it compares the wrong offsets and reports a
change on every pixel after the first row.

---

**[@variance-authority/png-sharp](https://variance-authority.dev/reference/packages/png-sharp)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
