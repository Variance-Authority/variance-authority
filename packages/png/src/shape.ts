import { pixelBox, type RegionChange } from '@variance-authority/core/attribute';
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
 * How far a pixel's colour is from its neighbour's for an edge, as the judge
 * measures a threshold of 0.05, and at most how far for flat: a quarter of it.
 * Fixed, not each side's own scale, so a stronger edge nearby changes nothing.
 * A pixel between them, as an anti-aliased edge often is, says nothing.
 */
const EDGE = Math.sqrt(limitOf(0.05));
const FLAT = EDGE / 4;

/**
 * What changed in `region`, from the pixels the comparison decoded and its row
 * pairing, on `canvas`, the comparison's own size, or `undefined` when neither side has an edge where
 * the pixels changed and one there is too faint to call flat, so nothing tells the two apart. Reads
 * only the pixels in its box and {@link REGION_MARGIN} around it, less the
 * pixels any `excluded` box covers, so the cost is the changed area.
 */
export function regionChange(
  { before, after, aligned }: ComparedPixels,
  { width, height }: { readonly width: number; readonly height: number },
  region: Rect,
  excluded: readonly Rect[],
): RegionChange | undefined {
  const left = Math.max(0, region.x - REGION_MARGIN);
  const top = Math.max(0, region.y - REGION_MARGIN);
  const columns = Math.min(width, region.x + region.width + REGION_MARGIN) - left;
  const rows = Math.min(height, region.y + region.height + REGION_MARGIN) - top;
  const inside = (x: number, y: number) =>
    x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;
  const covered = excluded.map(pixelBox);
  const skipped = (x: number, y: number) =>
    covered.some((box) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height);
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

  const first = edges(before.data, was, columns);
  const second = edges(after.data, now, columns);
  for (let index = 0; index < first.length; index += 1) {
    if (first[index]! >= 0 && second[index]! >= 0 && first[index] !== second[index]) return 'shape';
  }
  // Only a pixel whose own edge mark the change reached is evidence for colour:
  // an unchanged neighbour's edge, standing on both sides, says nothing of it.
  const changed = (index: number): boolean => {
    const at = was[index]!;
    const to = now[index]!;
    if (at < 0 || to < 0) return false;
    for (let channel = 0; channel < 4; channel += 1) if (before.data[at + channel] !== after.data[to + channel]) return true;
    return false;
  };
  const reached = (index: number): boolean =>
    changed(index) || ((index + 1) % columns !== 0 && changed(index + 1)) || changed(index + columns);
  let faint = false;
  for (let index = 0; index < first.length; index += 1) {
    if (!reached(index)) continue;
    if (first[index] === 1 || second[index] === 1) return 'colour';
    if (first[index] === -1 || second[index] === -1) faint = true;
  }
  // No edge where it changed, and a pixel too faint to call flat: nothing says the drawing stayed.
  return faint ? undefined : 'colour';
}

/**
 * Each read pixel marked by its edge in one image, its larger distance to its
 * right and lower neighbours: 1 an edge, 0 flat, -1 between them, and -2 unread
 * or with no neighbour read.
 */
function edges(data: Uint8Array, offsets: Int32Array, columns: number): Int8Array {
  // A word view starts only at a multiple of 4; a decoder's buffer at another offset is copied.
  const aligned = data.byteOffset % 4 === 0 ? data : new Uint8Array(data);
  const words = new Uint32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength >> 2);
  const towards = (at: number, to: number): number => {
    if (to < 0) return -1;
    if (words[at >> 2] === words[to >> 2]) return 0;
    return Math.sqrt(Math.abs(colorDeltaAt(data, at, data, to, at)));
  };
  const marks = new Int8Array(offsets.length).fill(-2);
  for (let index = 0; index < offsets.length; index += 1) {
    const at = offsets[index]!;
    if (at < 0) continue;
    const right = (index + 1) % columns === 0 ? -1 : offsets[index + 1]!;
    const below = index + columns < offsets.length ? offsets[index + columns]! : -1;
    const value = Math.max(towards(at, right), towards(at, below));
    if (value < 0) continue;
    if (value <= FLAT) marks[index] = 0;
    else if (value >= EDGE) marks[index] = 1;
    else marks[index] = -1;
  }
  return marks;
}
