// compass: variance-authority.retention

import { messageOf } from '@variance-authority/raster';

/**
 * A raster as a store keeps it: its image a lossless WebP, encoded here, by the
 * caller of `put`, and nowhere else.
 *
 * Every accept passes through this before `put`, whichever store it writes to.
 * A durable store refuses anything else, and a remote one receives the bytes it
 * keeps, so the server never runs a codec. A raster with no image passes as it
 * came, and so does one already kept.
 *
 * The encoder is libwebp through sharp, a native addon loaded on the first
 * accept and never by a run that accepts nothing. Where it cannot load, the
 * accept fails and names why: there is no slower encoder to fall back to.
 */
export async function keptRaster<R extends { readonly bytes?: string }>(raster: R): Promise<R> {
  if (raster.bytes === undefined) return raster;
  let keepImage: (bytes: Buffer) => Promise<Buffer>;
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
  return { ...raster, bytes: (await keepImage(Buffer.from(raster.bytes, 'base64'))).toString('base64') };
}
