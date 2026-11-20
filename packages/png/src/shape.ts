import type { RegionChange } from '@variance-authority/core/attribute';
import type { Rect } from '@variance-authority/core/format';
import type { ComparedPixels } from './compare.js';
import { colorDelta, limitOf } from './judge.js';

/*
 * Whether a changed region's drawing changed, or only its colour.
 *
 * A region's grade measures how far its pixels moved in colour, and a 1 px
 * shift of dark text grades as strong as a brand recolour. What tells them
 * apart is structure: which pixels are ink and which are ground. Each side of
 * a region is read in black and white against its own ground, the colour most
 * of its pixels have, and the two are compared pixel by pixel: ink that moved
 * is `shape`, ink where it was in another colour is `colour`.
 */

/**
 * Pixels read around each region's box: a block moved by a pixel is changed
 * only along its edges, and a box one column wide holds nothing but ink on one
 * side and ground on the other, which a recolour also gives.
 */
export const REGION_MARGIN = 2;

/**
 * Below this squared distance from its ground, as `limitOf` measures a policy's
 * threshold, a side has no ink: a fill repainted by a little reads as all ground.
 */
const FLAT = limitOf(0.1);

/**
 * What changed in `region`, from the pixels the comparison decoded and its row
 * pairing. Reads only the pixels in its box and {@link REGION_MARGIN} around
 * it, so the cost is the changed area.
 */
export function regionChange({ before, after, aligned }: ComparedPixels, region: Rect): RegionChange {
  // The canvas is the after image's when the rows were paired, the box holding both when they were not.
  const width = aligned === null ? Math.max(before.width, after.width) : after.width;
  const height = aligned === null ? Math.max(before.height, after.height) : after.height;
  const left = Math.max(0, region.x - REGION_MARGIN);
  const right = Math.min(width, region.x + region.width + REGION_MARGIN);
  const top = Math.max(0, region.y - REGION_MARGIN);
  const bottom = Math.min(height, region.y + region.height + REGION_MARGIN);
  const inside = (x: number, y: number) =>
    x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;

  // Each canvas pixel's offset in either image, read once.
  const was: number[] = [];
  const now: number[] = [];
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const source = aligned === null ? y : (aligned.strips.find((strip) => x < strip.to)?.source[y] ?? -1);
      const paired = source >= 0 && source < before.height && x < before.width && y < after.height && x < after.width;
      // Content with nothing opposite it, an inserted row or a side the other image lacks, is drawing that changed.
      if (!paired) {
        if (inside(x, y)) return 'shape';
        continue;
      }
      was.push((source * before.width + x) * 4);
      now.push((y * after.width + x) * 4);
    }
  }

  const ink = (data: Uint8Array, offsets: readonly number[]): Int8Array => {
    const side = new Uint8Array(offsets.length * 4);
    offsets.forEach((at, index) => side.set(data.subarray(at, at + 4), index * 4));
    const ground = groundOf(side);
    const distance = new Float64Array(offsets.length);
    let far = 0;
    for (let index = 0; index < offsets.length; index += 1) {
      distance[index] = Math.sqrt(Math.abs(colorDelta(side, ground, index * 4, now[index]!)));
      far = Math.max(far, distance[index]!);
    }
    // 1 ink, 0 ground, -1 between them: an anti-aliased edge says nothing either way.
    const marks = new Int8Array(offsets.length);
    if (far * far < FLAT) return marks;
    distance.forEach((value, index) => (marks[index] = value <= far / 4 ? 0 : value >= (far * 3) / 4 ? 1 : -1));
    return marks;
  };
  const first = ink(before.data, was);
  const second = ink(after.data, now);
  for (let index = 0; index < first.length; index += 1) {
    if (first[index]! >= 0 && second[index]! >= 0 && first[index] !== second[index]) return 'shape';
  }
  return 'colour';
}

/** `pixels` filled with the colour most of them have, so a distance reads each against it at its own offset. */
function groundOf(pixels: Uint8Array): Uint8Array {
  const words = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length / 4);
  const counts = new Map<number, number>();
  let best = 0;
  let most = 0;
  for (const word of words) {
    const count = (counts.get(word) ?? 0) + 1;
    counts.set(word, count);
    if (count > most) [best, most] = [word, count];
  }
  const ground = new Uint8Array(pixels.length);
  new Uint32Array(ground.buffer).fill(best);
  return ground;
}
