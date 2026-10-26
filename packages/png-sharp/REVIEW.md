# Reviewing `@variance-authority/png-sharp`

`sharpDecoder`, a `PngDecoder` that decodes through libvips on libuv's
threadpool instead of `pngjs` on the main thread. `cli` loads it under the
`decoder` key; `png`'s `compareRasters` takes it as its `decoder` option.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/png-sharp/`.

## Contracts

- **The decoder changes what a run costs, never what it decides.** For every
  PNG `pngjs` decodes, `sharpDecoder` gives byte-identical 8-bit RGBA, and the
  comparison and its mask agree, padding included. Written in the
  [README](README.md#the-two-decoders-produce-the-same-pixels) and pinned by
  [`src/decoder.test.ts`](src/decoder.test.ts) › "reaches the same
  comparison, including the mask" and "pads a size mismatch the same way,
  rather than refusing it".
- **Four channels, always.** A PNG with no alpha decodes to RGBA, never to
  three bytes a comparison reads at the wrong offsets. Written in the
  [README](README.md#the-two-decoders-produce-the-same-pixels) and the comment
  in [`sharpDecoder`](src/index.ts); no parity case has three channels.
- **A native addon stays out of `png`.** Whoever cannot load a `.node` file
  uses `png` alone. Written in [ADR-0013][adr-0013].

## Where to look for a counterexample

- `src/index.ts`, against `src/decoder.test.ts`: every parity case is 8-bit
  RGBA that `pngjs` wrote. An RGB PNG, a 16-bit, greyscale, palette or
  Adam7-interlaced one, all of which `png` documents `pngjs` accepting, is
  where libvips' depth or channels can part from `pngjs` with no test failing.

## Not this package's

- Falling back to `pngjs` when the addon will not load, and failing under
  `decoder: "sharp"`: `cli` owns it, in `src/commands/resources.ts`.
- The comparison the pixels feed: `png`.

[adr-0013]:
  ../../docs/context/adr/0013-packages-are-named-for-their-requirements.md
