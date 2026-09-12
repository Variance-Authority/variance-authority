/**
 * `@variance-authority/png/mask` — the difference mask, without a codec.
 *
 * `pixelmatch` takes RGBA and returns RGBA. Nothing in the per-pixel work needs
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

import pixelmatch from 'pixelmatch';
import { DEFAULT_POLICY, type DiffPolicy } from '@variance-authority/raster';

/**
 * One decoded image: raw 8-bit RGBA, row-major, no padding.
 *
 * The shape `pixelmatch` needs and the smallest thing every decoder agrees on.
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
}

/**
 * Copy `image` onto an opaque white canvas, top-left aligned.
 *
 * `pixelmatch` requires equal dimensions and Playwright's own `toHaveScreenshot`
 * simply fails when they differ. Failing is the easy choice and the dishonest
 * one — it lets a layout change score "detected" without measuring anything. So
 * both are padded onto the union box and the padding is reported, which is the
 * more generous treatment: a story that grew by one row differs in that row
 * rather than in its entire area.
 *
 * White because a page's declared canvas is white. Transparent padding would
 * invent a difference wherever the shorter image's own background is opaque,
 * which is every subject.
 */
export function padTo(image: DecodedImage, width: number, height: number): DecodedImage {
  if (image.width === width && image.height === height) return image;

  // Row-major RGBA copy rather than `PNG.bitblt`, because the input here is
  // whatever decoder the caller chose and only `pngjs` produces a `PNG`. Same
  // result: an opaque white canvas with the image at the top left.
  const data = new Uint8Array(width * height * 4).fill(0xff);
  const rowBytes = image.width * 4;
  for (let y = 0; y < image.height; y += 1) {
    data.set(image.data.subarray(y * rowBytes, (y + 1) * rowBytes), y * width * 4);
  }
  return { width, height, data };
}

/**
 * Two images onto one mask, at a policy, on the union box.
 *
 * `diffMask` is the difference between the two things this is asked for. Off,
 * `pixelmatch` renders the familiar picture — the after image dimmed with the
 * changed pixels in red — which is what a human opens. On, it writes *only* the
 * differing pixels and leaves the rest transparent, so the alpha channel is the
 * mask and nothing has to be recovered from red-on-grey.
 */
export function differencePixels(
  before: DecodedImage,
  after: DecodedImage,
  policy: DiffPolicy = DEFAULT_POLICY,
  { diffMask = false }: { readonly diffMask?: boolean } = {},
): PixelDifference {
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);

  const data = new Uint8Array(width * height * 4);
  const changed = pixelmatch(
    padTo(before, width, height).data,
    padTo(after, width, height).data,
    data,
    width,
    height,
    { threshold: policy.threshold, includeAA: policy.includeAA, diffMask },
  );

  return { width, height, data, changed };
}
