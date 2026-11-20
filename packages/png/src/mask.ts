/**
 * `@variance-authority/png/mask` — the difference mask, without a codec.
 *
 * The comparison takes RGBA and returns RGBA. Nothing in the per-pixel work needs
 * a decoder, and the only reason it ever lived beside one is that every caller
 * in this repository happened to be holding PNG bytes. A caller holding pixels —
 * a canvas, a framebuffer, `createImageBitmap` in a review page — should not
 * have to install `pngjs` to reach the same arithmetic, and a bundler following
 * this subpath must not find it.
 *
 * So the subpath exists, and it exports exactly two things: the padding rule and
 * the diff. Both matter more than they look, because a diff is now computed in
 * two places — Node, when a run writes its report, and the browser, when a
 * reviewer opens a change whose mask was never uploaded. Two ends computing the
 * same thing from the same inputs is only safe while it is literally the same
 * code; the moment one of them reimplements padding or re-reads a threshold, the
 * two disagree silently and the reviewer is looking at a mask the verdict was
 * not made from. Hence one function, imported by both.
 */

import { DEFAULT_POLICY, type DiffPolicy, type RowAlignment } from '@variance-authority/raster';
import type { AlignedRows } from './align.js';
import { judgeImages } from './images.js';

export type { AlignedRows } from './align.js';
export { padTo } from './images.js';

/**
 * One decoded image: raw 8-bit RGBA, row-major, no padding.
 *
 * The shape the comparison needs and the smallest thing every decoder agrees on.
 */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer | Uint8Array;
}

/** A difference, as pixels and a count — whatever the caller wanted rendered. */
export interface PixelDifference {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  /** Pixels the policy called different. The number the verdict is made from. */
  readonly changed: number;
  /** How the rows were paired, when they were: see `alignRows`. */
  readonly alignment?: RowAlignment;
}

/**
 * Two images onto one mask, at a policy. `diffMask` off renders the picture a
 * human opens, changed pixels on the dimmed before image (see `FAINT`); on, only
 * the changed pixels, so the alpha channel is the mask.
 *
 * Aligned rows (`alignRows`) are compared by content on the after canvas, and an
 * after row with no partner is marked in full; otherwise by position on the
 * union box. `alignment` is the caller's, or `null` when it found none.
 */
export function differencePixels(
  before: DecodedImage,
  after: DecodedImage,
  policy: DiffPolicy = DEFAULT_POLICY,
  {
    diffMask = false,
    alignment: given,
  }: { readonly diffMask?: boolean; readonly alignment?: AlignedRows | null } = {},
): PixelDifference {
  const judged = judgeImages(before, after, [policy], given, { picture: { policy: 0, diffMask, graded: true } });
  const { width, height, changed, picture, alignment } = judged;
  return { width, height, data: picture!, changed: changed[0]!, ...(alignment === undefined ? {} : { alignment }) };
}
