/**
 * Two images judged on one canvas: padded to the union box when their rows do
 * not align, and on the after image's rows, strip by strip, when they do.
 */

import { type DiffPolicy, type RowAlignment, SEVERITY_LEVELS } from '@variance-authority/raster';
import { ALIGNMENT_LIMIT, alignRows, type AlignedRows } from './align.js';
import { judgeRows, type JudgeOutput } from './judge.js';
import type { DecodedImage } from './mask.js';

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

/** Every policy's verdict on two images, and the canvas it was reached on. */
export interface JudgedImages {
  readonly width: number;
  readonly height: number;
  readonly changed: number[];
  readonly mask?: Uint8Array;
  readonly picture?: Uint8Array;
  readonly alignment?: RowAlignment;
}

/**
 * Two images under every policy at once: {@link differencePixels}' rule, in
 * one scan rather than one per policy.
 *
 * The policies differ only in what they call a different pixel, so the rows are
 * aligned once, under the policy whose mask or picture is drawn, so its verdict
 * is the same whatever is judged beside it; each pixel is read once, and
 * anti-aliasing is asked about once however many policies forgive it.
 */
export function judgeImages(
  before: DecodedImage,
  after: DecodedImage,
  policies: readonly DiffPolicy[],
  given: AlignedRows | null | undefined,
  output: JudgeOutput,
): JudgedImages {
  // `null` is a caller that already asked and found no alignment.
  const drawn = policies[output.mask ?? output.picture?.policy ?? 0]!;
  const alignment = given === undefined ? alignRows(before, after, ALIGNMENT_LIMIT, drawn.threshold) : (given ?? undefined);

  if (alignment === undefined || unmoved(alignment, before, after)) {
    const width = Math.max(before.width, after.width);
    const height = Math.max(before.height, after.height);
    const judged = judgeRows(padTo(before, width, height), padTo(after, width, height), undefined, policies, output);
    return { width, height, ...judged, ...(alignment === undefined ? {} : { alignment: spans(alignment) }) };
  }

  const { width, height } = after;
  // An inserted row is compared with itself, so it counts nothing there and is
  // marked here, in full, rather than against an invented background.
  const { changed, mask, picture } = judgeRows(before, after, alignment.strips, policies, output);
  const row = width * 4;
  const diffMask = output.picture?.diffMask;

  for (const strip of alignment.strips) {
    for (const span of strip.inserted) {
      const pixels = (span.to - span.from) * (strip.to - strip.from);
      for (let index = 0; index < changed.length; index += 1) changed[index]! += pixels;
      for (let y = span.from; y < span.to; y += 1) {
        mask?.fill(SEVERITY_LEVELS.length, y * width + strip.from, y * width + strip.to);
        if (picture === undefined) continue;
        for (let index = y * row + strip.from * 4; index < y * row + strip.to * 4; index += 4) {
          if (diffMask) picture.set(INSERTED, index);
          else {
            // The dimmed after pixel, tinted, so the inserted content stays legible.
            for (let channel = 0; channel < 3; channel += 1) {
              picture[index + channel] = Math.round(picture[index + channel]! * 0.6 + INSERTED[channel]! * 0.4);
            }
          }
        }
      }
    }
  }

  return {
    width,
    height,
    changed,
    ...(mask === undefined ? {} : { mask }),
    ...(picture === undefined ? {} : { picture }),
    alignment: spans(alignment),
  };
}

/** The colour `pixelmatch` marks a difference in, used for rows it never compared. */
const INSERTED = [255, 0, 0, 255] as const;

/** Every row paired with itself: the positional comparison, without a table. */
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
