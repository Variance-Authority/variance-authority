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

Sixteen distinct 1280×800 images, cold, every candidate verified byte-identical
to `pngjs`'s RGBA before being timed:

| One 1280×800 PNG → RGBA | |
|---|---|
| Chromium | **12.4 ms** |
| this package | **14.5 ms** |
| `pngjs` (the default) | 23.5 ms |
| `@cwasm/lodepng` | 28.3 ms |
| `@cf-wasm/png` | 99.8 ms |

Both wasm decoders measured *slower* than the pure-JS one, which is why the
portable default is not simply the second-fastest option — there is no fast
portable option to pick. **And the fastest decoder in that table is not a
library at all**: it is the browser this system already launches. That is a real
win and it is not this package — it is a design change, and it is
[spec 0011](../../docs/specs/0011-storage-and-cache-primitives.md)'s to make. Nothing here
recovers it.

That table is journal-transcribed and only the middle three rows can be
re-derived from this workspace; the wasm decoders are not dependencies of
anything here and Chromium is not reachable from a package that must not need
one.

The per-image 1.6× is the smaller half. libvips decodes on **libuv's
threadpool**, so images decoded concurrently leave the main thread entirely:

```
$ UV_THREADPOOL_SIZE=12 node packages/png-sharp/scripts/bench.mjs
32 images, 1280×800, ~283 KiB each, one process
node v26.7.0, sharp 0.34.5, libvips 8.17.3

| `Promise.all`, pool of 12 | 0.8 ms |
| one at a time            | 3.3 ms |
| `pngjs`, one at a time   | 7.3 ms |

spread: 8.8×
```

**Concurrency is the whole prize** — 4× over the same decoder called in a loop,
and 9× over the default. The threadpool size is the smaller lever and its size
depends on the machine: on the 16-core host above, a pool of 12 buys 1.25× over
the default pool of 4, because four libvips threads already saturate a decode
this cheap. On a smaller box the gap is wider. libuv reads `UV_THREADPOOL_SIZE`
from the environment before the pool is first used, so it cannot be set from
inside this package, and the number above is the *shape* of the effect rather
than a figure to expect.

`scripts/bench.mjs` generates its own images and re-derives every row, so these
three are reproducible where the first table's outer rows are not.

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
