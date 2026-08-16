<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/png-sharp

**Requires:** a runtime that can load a compiled native addon, and a platform
somebody has published binaries for. Not a Worker, not an edge runtime, not a
bundle that cannot carry a `.node` file. That requirement is the entire reason
this is its own package.

The comparison is unchanged. Only the decoding is faster.

## Why a whole package for one function

Because [ADR-0013](../../docs/context/adr/0013-packages-are-named-for-their-requirements.md)
cuts packages by what a consumer must supply, and this one asks for something
`@variance-authority/png` deliberately does not: a binary that has to exist,
built for this machine. Fold it in and every consumer of a comparison installs a
compiled artifact to reach a pure-JS default they may never leave — including the
tribunal, which runs on Cloudflare Workers and could not load it at all.

So it lives here, and a consumer opts in by depending on it.

## What it buys, measured

[Journal 0016](../../docs/context/journal/0016-where-the-time-actually-goes.md)
found the raster tier's cost is not where it looks. Decoding is **90% of a
comparison**; `pixelmatch` is 9%. So the decoder *is* the cost.

| One 1280×800 PNG → RGBA | |
|---|---|
| this package | **15.0 ms** |
| `pngjs` (the default) | 22.6 ms |
| `@cwasm/lodepng` | 28.3 ms |
| `@cf-wasm/png` | 99.8 ms |

The per-image 1.5× is the smaller half. libvips decodes on **libuv's threadpool**,
so images decoded concurrently leave the main thread entirely:

| 32 images, one process | per image |
|---|---|
| `Promise.all`, `UV_THREADPOOL_SIZE=12` | **1.9 ms** |
| `Promise.all`, default pool of 4 | 4.1 ms |
| one at a time | 14.6 ms |
| `pngjs`, one at a time | 23.9 ms |

**12× at the top end**, and the threadpool size is most of the difference between
the first two rows. libuv reads `UV_THREADPOOL_SIZE` from the environment before
the pool is first used, so it cannot be set from inside this package.

Both wasm decoders measured *slower* than the pure-JS one, which is why the
portable default is not simply the second-fastest option — there is no fast
portable option to pick.

## Use

```ts
import { compareRasters } from '@variance-authority/png';
import { sharpDecoder } from '@variance-authority/png-sharp';

const comparison = await compareRasters(before, after, { decoder: sharpDecoder });
```

`variance run` does this for you. Its `decoder` config key is `auto` by default,
which prefers this package and **falls back to `pngjs` without failing** when the
addon will not load — a machine missing the binary should produce the same
verdicts more slowly, never no verdicts. Set `"decoder": "sharp"` to make that
fallback an error instead, which is what a build machine wants.

## The rule that makes substitution safe

A run may pick either decoder depending on what a machine can load, so the two
must produce **byte-identical RGBA**. If they differed by one byte, a subject
would be `changed` on a laptop and `unchanged` in CI with nothing in either
report to explain it.

`src/decoder.test.ts` asserts the bytes rather than the verdicts — comparing
verdicts would pass while both decoders were wrong in the same direction — over
flat colour, a gradient that exercises every PNG filter type, partial
transparency, a fully transparent image where a premultiplying decoder would lose
the colour, and a one-pixel image. It also checks the mask survives a size
mismatch, since padding was rewritten off `PNG.bitblt` to accept any decoder's
output.
