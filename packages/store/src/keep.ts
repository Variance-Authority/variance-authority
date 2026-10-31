// compass: variance-authority.retention

import { messageOf } from '@variance-authority/raster';

/**
 * A raster as a store keeps it: its image a lossless WebP, encoded here, by the
 * caller of `put`, and nowhere else.
 *
 * Every accept passes through this before `put`, whichever store it writes to.
 * A durable store refuses anything else, and a remote one receives the bytes it
 * keeps, so the server never runs a codec. A raster with no image passes as it
 * came; one already kept keeps its bytes. Either way a kept image carries the
 * digest of its pixels, so the comparison against it can skip decoding it.
 *
 * The encoder is libwebp through sharp, a native addon loaded on the first
 * accept and never by a run that accepts nothing. Where it cannot load, the
 * accept fails and names why: there is no slower encoder to fall back to.
 */
export async function keptRaster<R extends { readonly bytes?: string; readonly pixels?: string }>(
  raster: R,
): Promise<R> {
  if (raster.bytes === undefined) return raster;
  let keepImage: typeof import('@variance-authority/png-sharp').keepImage;
  try {
    ({ keepImage } = await import('@variance-authority/png-sharp'));
  } catch (error) {
    throw new Error(
      'an accepted image is kept as a WebP encoded by sharp, and sharp did not load on this machine: ' +
        `${messageOf(error)}. Install sharp's binary for this platform (see sharp's installation guide), ` +
        'or accept on a machine that has it.',
      { cause: error },
    );
  }
  const kept = await keepImage(Buffer.from(raster.bytes, 'base64'));
  return { ...raster, bytes: kept.bytes.toString('base64'), pixels: kept.pixels };
}
