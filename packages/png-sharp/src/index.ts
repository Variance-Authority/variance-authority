import sharp from 'sharp';
import { imageFormat, refuseOversize, refuseUnkept, type DecodedImage, type PngDecoder } from '@variance-authority/png';

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

/**
 * The bytes a store keeps for an accepted capture: a lossless WebP at effort 2,
 * 73% smaller than the PNG in about 170 ms a page (#860), decoded back before
 * it is returned. It runs on the accept, never on a comparison.
 *
 * The check is what a comparison reads: a pixel with any opacity comes back in
 * every channel, a transparent one comes back transparent, and the colour under
 * it is lost, since libvips does not pass libwebp's `exact`. A lossless WebP
 * passes through; a lossy one, or one over `KEEP_LIMIT`, is refused undecoded.
 */
export async function keepImage(bytes: Buffer): Promise<Buffer> {
  const format = imageFormat(bytes);
  if (format === 'webp') {
    refuseUnkept(bytes);
    return bytes;
  }
  if (format !== 'png') {
    throw new Error(`these ${bytes.length} bytes are neither a PNG nor a WebP: their header declares no image format.`);
  }
  refuseOversize(bytes);

  const kept = await sharp(bytes).webp({ lossless: true, effort: 2 }).toBuffer();
  refuseUnkept(kept);
  // The only proof the kept bytes are the accepted pixels: a store that kept
  // anything else would make every later verdict about a picture nobody approved.
  const [source, back] = await Promise.all([sharpDecoder.decode(bytes), sharpDecoder.decode(kept)]);
  if (back.width !== source.width || back.height !== source.height || !sameToTheEye(source.data, back.data)) {
    throw new Error(
      `the WebP encoder returned a ${back.width}x${back.height} image that does not decode to the ` +
        `${source.width}x${source.height} capture it was given; nothing was kept.`,
    );
  }
  return kept;
}

/** Every channel of every pixel with any opacity, and the transparency of the rest. */
function sameToTheEye(before: Uint8Array, after: Uint8Array): boolean {
  if (before.length !== after.length) return false;
  for (let at = 0; at < before.length; at += 4) {
    if (before[at + 3] === 0) {
      if (after[at + 3] !== 0) return false;
    } else if (
      before[at] !== after[at] ||
      before[at + 1] !== after[at + 1] ||
      before[at + 2] !== after[at + 2] ||
      before[at + 3] !== after[at + 3]
    ) {
      return false;
    }
  }
  return true;
}
