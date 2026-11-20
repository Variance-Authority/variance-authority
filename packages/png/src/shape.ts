import type { RegionChange } from '@variance-authority/core/attribute';
import type { Rect } from '@variance-authority/core/format';
import type { ComparedPixels } from './compare.js';
import { colorDeltaAt, limitOf } from './judge.js';

/*
 * Whether a changed region's drawing changed, or only its colour.
 *
 * A region's pixel count says how many pixels moved in colour, and a 1 px
 * shift of dark text counts much as a brand recolour does. What tells them
 * apart is structure: where each image has an edge. Each side is read on its
 * own, every pixel against its right and lower neighbours in the same image,
 * and the two are compared pixel by pixel: an edge where the other side is
 * flat is `shape`, edges where they were in other colours are `colour`.
 */

/**
 * Pixels read around each region's box: a block moved by a pixel is changed
 * only along its edges, and a box one column wide holds no edge of its own.
 */
export const REGION_MARGIN = 2;

/**
 * Below this squared distance, as `limitOf` measures a policy's threshold, a
 * side's strongest edge is no edge: a fill repainted by a little reads as flat.
 */
const FLAT = limitOf(0.1);

/**
 * What changed in `region`, from the pixels the comparison decoded and its row
 * pairing. Reads only the pixels in its box and {@link REGION_MARGIN} around
 * it, less any in `excluded`, so the cost is the changed area.
 */
export function regionChange(
  { before, after, aligned }: ComparedPixels,
  region: Rect,
  excluded: readonly Rect[] = [],
): RegionChange {
  // The canvas is the after image's when the rows were paired, the box holding both when they were not.
  const width = aligned === null ? Math.max(before.width, after.width) : after.width;
  const height = aligned === null ? Math.max(before.height, after.height) : after.height;
  const left = Math.max(0, region.x - REGION_MARGIN);
  const top = Math.max(0, region.y - REGION_MARGIN);
  const columns = Math.min(width, region.x + region.width + REGION_MARGIN) - left;
  const rows = Math.min(height, region.y + region.height + REGION_MARGIN) - top;
  const inside = (x: number, y: number) =>
    x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;
  const skipped = (x: number, y: number) =>
    excluded.some((box) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height);
  // Each column's pairing of after rows to before rows, found once per column rather than per pixel.
  const pairing = Array.from({ length: Math.max(0, columns) }, (_, column) =>
    aligned === null ? null : (aligned.strips.find((strip) => left + column < strip.to)?.source ?? null),
  );

  // Each read pixel's byte offset in either image, -1 where it is not read.
  const was = new Int32Array(Math.max(0, columns * rows)).fill(-1);
  const now = new Int32Array(was.length).fill(-1);
  for (let row = 0; row < rows; row += 1) {
    const y = top + row;
    for (let column = 0; column < columns; column += 1) {
      const x = left + column;
      if (excluded.length > 0 && skipped(x, y)) continue;
      const source = aligned === null ? y : (pairing[column]?.[y] ?? -1);
      const paired = source >= 0 && source < before.height && x < before.width && y < after.height && x < after.width;
      // Content with nothing opposite it, an inserted row or a side the other image lacks, is drawing that changed.
      if (!paired) {
        if (inside(x, y)) return 'shape';
        continue;
      }
      was[row * columns + column] = (source * before.width + x) * 4;
      now[row * columns + column] = (y * after.width + x) * 4;
    }
  }

  const first = edges(before.data, was, columns, now);
  const second = edges(after.data, now, columns, now);
  for (let index = 0; index < first.length; index += 1) {
    if (first[index]! >= 0 && second[index]! >= 0 && first[index] !== second[index]) return 'shape';
  }
  return 'colour';
}

/**
 * Each read pixel marked by its edge in one image, its larger distance to its
 * right and lower neighbours: 1 an edge, 0 flat, -1 between them or unread. An
 * anti-aliased edge says nothing either way, and how strong an edge is counts
 * against the side's strongest, so a repaint that softens every edge keeps them.
 */
function edges(data: Uint8Array, offsets: Int32Array, columns: number, canvas: Int32Array): Int8Array {
  const words = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
  const strength = new Float32Array(offsets.length).fill(-1);
  let far = 0;
  const towards = (at: number, to: number, pos: number): number => {
    if (to < 0) return -1;
    if (words[at >> 2] === words[to >> 2]) return 0;
    return Math.sqrt(Math.abs(colorDeltaAt(data, at, data, to, pos)));
  };
  for (let index = 0; index < offsets.length; index += 1) {
    const at = offsets[index]!;
    if (at < 0) continue;
    const right = (index + 1) % columns === 0 ? -1 : offsets[index + 1]!;
    const below = index + columns < offsets.length ? offsets[index + columns]! : -1;
    const value = Math.max(towards(at, right, canvas[index]!), towards(at, below, canvas[index]!));
    strength[index] = value;
    far = Math.max(far, value);
  }
  const marks = new Int8Array(offsets.length).fill(-1);
  const flat = far * far < FLAT;
  for (let index = 0; index < offsets.length; index += 1) {
    const value = strength[index]!;
    if (value < 0) continue;
    if (flat || value <= far / 8) marks[index] = 0;
    else if (value >= far / 2) marks[index] = 1;
  }
  return marks;
}
