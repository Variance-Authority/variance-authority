<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/png-sharp

**Requires:** a runtime that can load a compiled native addon, and a platform
somebody has published binaries for. Not a Worker, not an edge runtime, not a
bundle that cannot carry a `.node` file. That requirement is the entire reason
this is its own package.

The comparison is unchanged. Only the decoding is faster.

## Use this package when

Install `@variance-authority/png-sharp` alongside `@variance-authority/png` when
the process can load Sharp's native addon and concurrent PNG decoding is worth
the platform dependency. Keep [`@variance-authority/png`](../png) alone for a
portable Node install, a Worker, or an edge bundle. The package supplies a
decoder; it does not compare images, launch a browser, or choose a policy.

```sh
npm install @variance-authority/png @variance-authority/png-sharp
```

## Package boundary

Because [ADR-0013](../../docs/context/adr/0013-packages-are-named-for-their-requirements.md)
cuts packages by what a consumer must supply, and this one asks for something
`@variance-authority/png` deliberately does not: a binary that has to exist,
built for this machine. Fold it in and every consumer of a comparison installs a
compiled artifact to reach a pure-JS default they may never leave — including the
tribunal, which runs on Cloudflare Workers and could not load it at all.

So it lives here, and a consumer opts in by depending on it.

## Decoder cost

Choose this decoder when PNG decoding is a material part of the run or when
several images are decoded concurrently. libvips uses libuv's threadpool, so
concurrent calls can leave the main thread while the portable decoder cannot.

Measure the trade on the deployment machine; native-addon loading, image shape,
concurrency, and `UV_THREADPOOL_SIZE` all affect the result:

```bash
node node_modules/@variance-authority/png-sharp/scripts/bench.mjs
```

The benchmark generates its inputs and checks every decoded RGBA buffer against
`pngjs` before reporting time. `UV_THREADPOOL_SIZE` must be set before Node
creates the pool; this package does not change it.

## Use

```ts
import { readFileSync } from 'node:fs';
import { compareRasters, foreignRaster } from '@variance-authority/png';
import { sharpDecoder } from '@variance-authority/png-sharp';

const before = foreignRaster(readFileSync('artifacts/before.png'), {
  painter: 'chromium@131',
});
const after = foreignRaster(readFileSync('artifacts/after.png'), {
  painter: 'chromium@131',
});
const comparison = await compareRasters(before, after, { decoder: sharpDecoder });
console.log(comparison.changed, comparison.mask.changed);
```

The result has the same changed-pixel counts and mask as the portable decoder;
the decoder is the only substituted part. `sharpDecoder.decode(bytes)` is also
available when a caller needs a `DecodedImage` for `comparePixels`.

`variance run` does this for you. Its `decoder` config key is `auto` by default,
which prefers this package and **falls back to `pngjs` without failing** when the
addon will not load — a machine missing the binary should produce the same
verdicts more slowly, never no verdicts. Set `"decoder": "sharp"` to make that
fallback an error instead, which is what a build machine wants.

## Decoder compatibility

A run may pick either decoder depending on what a machine can load, so the two
must produce **byte-identical RGBA**. If they differed by one byte, a subject
would be `changed` on a laptop and `unchanged` in CI with nothing in either
report to explain it.

Byte identity covers flat colour, every PNG filter type, partial transparency,
fully transparent pixels whose colour must survive, one-pixel images, and the
padding required for a size mismatch. Verdict equality alone is insufficient:
two decoders can agree after losing the same byte information.

If the native addon cannot load, `sharpDecoder` rejects; the CLI's default
`decoder: "auto"` selection catches that and falls back to `pngjs`. Set
`decoder: "sharp"` when a missing native binary should fail the run instead.
