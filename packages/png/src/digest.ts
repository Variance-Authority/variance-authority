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

/**
 * The digest of an image's edges: where its colours meet, and nothing about
 * what they are.
 *
 * Each pixel contributes whether it differs from its right neighbour and from
 * the one below it, so the digest is that of the partition of the image into
 * runs of one colour. Any recolouring that keeps two different colours
 * different — a theme, a design token moving — leaves it where it was; a box
 * that moves, a glyph that changes, a size that changes, or two colours that
 * become one moves it. No luminance threshold: the contrast an edge needs is
 * any at all, so nothing a recolour does to contrast can push an edge across
 * one. A threshold was measured and rejected: rotating the hue of a set of
 * component baselines kept the edges of ten in thirteen exactly, and kept those
 * of at most three at any threshold from 16 to 64 out of 255.
 *
 * Absent when more than half the pixels sit on an edge. A gradient, a photo or
 * noise differs from its neighbours almost everywhere, so its mask is nearly
 * all edges and a change inside it leaves the mask where it was: the digest
 * would call a change of shape a change of colour. Component baselines put an
 * edge under at most one pixel in seven.
 *
 * It classifies a difference already found, and settles nothing: two images
 * that share it may differ in every pixel.
 */
export function edgeDigest(image: DecodedImage): Digest | undefined {
  const { width, height, data } = image;
  const edges = new Uint8Array(width * height);
  let edged = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      const here = colourAt(data, at);
      edges[at] =
        (x + 1 < width && colourAt(data, at + 1) !== here ? 1 : 0) |
        (y + 1 < height && colourAt(data, at + width) !== here ? 2 : 0);
      if (edges[at] !== 0) edged += 1;
    }
  }
  if (edged * 2 > width * height) return undefined;
  const hash = createHash('sha256').update(`edges\u0000${width}x${height}\u0000`).update(edges);
  return digestOfSha256(hash.digest('hex'));
}

/** One pixel as a number, with every fully transparent pixel the same one. */
function colourAt(data: Uint8Array, pixel: number): number {
  const at = pixel * 4;
  const alpha = data[at + 3]!;
  return alpha === 0 ? 0 : ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | alpha) >>> 0;
}
