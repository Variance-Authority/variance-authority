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
import { DEFAULT_POLICY, type DiffPolicy, type RowAlignment } from '@variance-authority/raster';
import { alignRows, type AlignedRows } from './align.js';

export type { AlignedRows } from './align.js';

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
  /** How the rows were paired, when they were: see {@link alignRows}. */
  readonly alignment?: RowAlignment;
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
 * Two images onto one mask, at a policy.
 *
 * `diffMask` is the difference between the two things this is asked for. Off,
 * `pixelmatch` renders the familiar picture — the after image dimmed with the
 * changed pixels in red — which is what a human opens. On, it writes *only* the
 * differing pixels and leaves the rest transparent, so the alpha channel is the
 * mask and nothing has to be recovered from red-on-grey.
 *
 * When the rows align ({@link alignRows}), each after row is compared with the
 * before row that shows the same content, on the after image's canvas, and an
 * after row with no partner is marked in full. Otherwise the two are compared
 * position by position on the union box. `alignment` is the caller's, when it
 * computed one already for another policy over the same two images, and `null`
 * when it asked and there was none.
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
  // `null` is a caller that already asked and found no alignment.
  const alignment = given === undefined ? alignRows(before, after) : (given ?? undefined);
  const options = { threshold: policy.threshold, includeAA: policy.includeAA, diffMask };

  if (alignment === undefined || unmoved(alignment, before, after)) {
    const width = Math.max(before.width, after.width);
    const height = Math.max(before.height, after.height);
    const data = new Uint8Array(width * height * 4);
    const changed = pixelmatch(
      padTo(before, width, height).data,
      padTo(after, width, height).data,
      data,
      width,
      height,
      options,
    );
    return { width, height, data, changed, ...(alignment === undefined ? {} : { alignment: spans(alignment) }) };
  }

  const { width, height } = after;
  const row = width * 4;
  // The before image, rearranged into the after image's rows. An inserted row
  // gets the after row itself, so `pixelmatch` counts nothing there and the row
  // is marked below, in full, rather than against an invented background.
  const warped = new Uint8Array(height * row);
  for (let y = 0; y < height; y += 1) {
    const from = alignment.source[y]!;
    warped.set(
      from < 0 ? after.data.subarray(y * row, (y + 1) * row) : before.data.subarray(from * row, (from + 1) * row),
      y * row,
    );
  }

  const data = new Uint8Array(height * row);
  let changed = pixelmatch(warped, after.data, data, width, height, options);

  for (const span of alignment.inserted) {
    for (let index = span.from * row; index < span.to * row; index += 4) {
      changed += 1;
      if (diffMask) data.set(INSERTED, index);
      else {
        // The dimmed after pixel, tinted, so the inserted content stays legible.
        for (let channel = 0; channel < 3; channel += 1) {
          data[index + channel] = Math.round(data[index + channel]! * 0.6 + INSERTED[channel]! * 0.4);
        }
      }
    }
  }

  return { width, height, data, changed, alignment: spans(alignment) };
}

/** The colour `pixelmatch` marks a difference in, used for rows it never compared. */
const INSERTED = [255, 0, 0, 255] as const;

/** Every row paired with itself: the positional comparison, without a copy. */
function unmoved(alignment: AlignedRows, before: DecodedImage, after: DecodedImage): boolean {
  return (
    before.height === after.height &&
    alignment.inserted.length === 0 &&
    alignment.removed.length === 0 &&
    alignment.shifted.length === 0
  );
}

function spans({ inserted, removed, shifted }: AlignedRows): RowAlignment {
  return { inserted, removed, shifted };
}
