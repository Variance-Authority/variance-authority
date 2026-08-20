import sharp from 'sharp';
import type { DecodedImage, PngDecoder } from '@variance-authority/png';

/**
 * `@variance-authority/png-sharp` — the same comparison, decoded by libvips.
 *
 * This package exists because of one measurement and one constraint.
 *
 * The measurement (journal 0016): decoding is **90% of a raster comparison**,
 * `pixelmatch` is 9%, and on a 1280×800 image `pngjs` takes 23.5 ms against
 * libvips' 14.5 ms. That alone is a 1.6× on the dominant cost. The larger number
 * is that libvips decodes on **libuv's threadpool**, so images decoded
 * concurrently leave the event loop entirely — `scripts/bench.mjs` measures
 * roughly 4x over the same decoder in a loop and 9x over sequential `pngjs`.
 * Two wasm decoders were measured and both were slower than the pure-JS one, so
 * this is not a case where the portable option is also the fast one. Chromium
 * decodes faster than any of them, and is not a library this package can be.
 *
 * The constraint (ADR-0013): `sharp` is a **native addon**. A Cloudflare Worker
 * cannot load one, and neither can a bundle for anywhere that is not this
 * machine's platform and libc. Putting it inside `@variance-authority/png` would
 * make every consumer of a comparison install a compiled binary in order to get
 * a pure-JS default they may never leave — so it is a separate requirement, in a
 * separate box, and a consumer opts in by depending on this package.
 *
 * ```ts
 * import { sharpDecoder } from '@variance-authority/png-sharp';
 * const comparison = await compareRasters(before, after, { decoder: sharpDecoder });
 * ```
 *
 * **Threadpool size is the smaller lever, and it is machine-dependent.** libuv
 * defaults to 4 threads; on a 16-core host raising it to `UV_THREADPOOL_SIZE=12`
 * buys about 1.25x, because four libvips threads already saturate a decode this
 * cheap. It can only be set before the process starts doing threadpool work, so
 * it belongs in the environment, not in this file.
 */
export const sharpDecoder: PngDecoder = {
  async decode(bytes: Buffer): Promise<DecodedImage> {
    // `ensureAlpha` rather than trusting the source: a PNG saved without an
    // alpha channel decodes to 3 bytes per pixel, and `pixelmatch` reads 4.
    // Three-channel data would not throw — it would silently compare the wrong
    // offsets and report a change on every pixel after the first row.
    const { data, info } = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return { width: info.width, height: info.height, data };
  },
};
