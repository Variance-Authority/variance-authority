import { createHash } from 'node:crypto';
import { digestOfSha256, type Digest } from '@variance-authority/core/format';
import type { DecodedImage } from './mask.js';

/**
 * The digest of an image's pixels: its width, its height and its RGBA, with the
 * colour under a fully transparent pixel taken as zero.
 *
 * Equal digests are equal pixels as a comparison reads them, so two images
 * that share one compare to nothing under every policy. That is the only thing
 * the digest is for: it lets a comparison skip decoding the side that recorded
 * it (see `compareRasters`), and it never decides anything a comparison of the
 * pixels would not. The colour under transparency is dropped because a kept
 * WebP does not keep it and a comparison does not read it.
 *
 * Of the decoded pixels, never of the encoded bytes: a capture is a PNG and a
 * kept baseline a WebP of the same pixels, and the two encodings share nothing.
 */
export function pixelDigest(image: DecodedImage): Digest {
  // Not `digestBytes`: its SHA-256 is core's portable one, slow over megabytes,
  // and it takes one buffer, where this streams the pixels to drop the colour
  // under transparency without copying them.
  const hash = createHash('sha256').update(`pixels\u0000${image.width}x${image.height}\u0000`);
  const { data } = image;
  let run = 0;
  let clear = 0;
  for (let at = 0; at < data.length; at += 4) {
    if (data[at + 3] === 0) {
      if (at > run) hash.update(data.subarray(run, at));
      clear += 4;
      run = at + 4;
    } else if (clear > 0) {
      hash.update(new Uint8Array(clear));
      clear = 0;
    }
  }
  if (data.length > run) hash.update(data.subarray(run));
  if (clear > 0) hash.update(new Uint8Array(clear));
  return digestOfSha256(hash.digest('hex'));
}
