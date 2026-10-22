import type { DecodedImage } from './mask.js';

/**
 * What a page holds, row by row: where the change image may cut and where an
 * outline may run without going through a line of text.
 */

/** Pixels unlike a row's background that a blank row may still hold: a box's two borders and their anti-aliasing. */
const BORDER_PIXELS = 4;
/** Colour changes along a row that a row without text may still hold: the edges of the boxes it crosses. */
const BOX_EDGES = 8;

/** The columns where any of `rows` differs from its own leftmost pixel: where it holds something. */
export function inkOf(rows: readonly (readonly [DecodedImage, number])[]): [number, number] | undefined {
  let left = Infinity;
  let right = -Infinity;
  for (const [image, y] of rows) {
    const start = y * image.width * 4;
    const background = image.data.subarray(start, start + 4);
    const holds = (x: number) => {
      const at = start + x * 4;
      return (
        image.data[at] !== background[0] ||
        image.data[at + 1] !== background[1] ||
        image.data[at + 2] !== background[2] ||
        image.data[at + 3] !== background[3]
      );
    };
    let x = 0;
    while (x < image.width && !holds(x)) x += 1;
    if (x === image.width) continue;
    left = Math.min(left, x);
    let end = image.width - 1;
    while (end >= Math.max(x, right) && !holds(end)) end -= 1;
    right = Math.max(right, end + 1);
  }
  return left < right ? [left, right] : undefined;
}

/** Row `y`'s pixels from column `from` to `to`, one word each. */
function words(image: DecodedImage, y: number, from: number, to: number): Uint32Array {
  const end = Math.min(to, image.width);
  if (end <= from) return new Uint32Array(0);
  return new Uint32Array(Uint8Array.from(image.data.subarray((y * image.width + from) * 4, (y * image.width + end) * 4)).buffer);
}

/** The colour most of a row's stretch is. */
function backgroundOf(row: Uint32Array): number {
  const counts = new Map<number, number>();
  let background = row[0]!;
  for (const word of row) {
    const count = (counts.get(word) ?? 0) + 1;
    counts.set(word, count);
    if (count > counts.get(background)!) background = word;
  }
  return background;
}

/**
 * Whether row `y` holds anything between columns `from` and `to`: more than a
 * border's worth of pixels unlike the colour most of that stretch is.
 */
export function inked(image: DecodedImage, y: number, from: number, to: number): boolean {
  const row = words(image, y, from, to);
  if (row.length === 0) return false;
  const background = backgroundOf(row);
  return row.reduce((sum, word) => sum + Number(word !== background), 0) > BORDER_PIXELS;
}

/**
 * Whether row `y` runs through text between columns `from` and `to`. A row
 * across a code block or a card changes colour only at the box's edges; one
 * through a line of text changes at every stroke.
 */
export function texted(image: DecodedImage, y: number, from: number, to: number): boolean {
  const row = words(image, y, from, to);
  let edges = 0;
  for (let x = 1; x < row.length; x += 1) if (row[x] !== row[x - 1]) edges += 1;
  return edges > BOX_EDGES;
}

/**
 * Whether row `y` is spacing between rows `above` and `below`: all one colour,
 * the colour those rows are mostly. A row of another colour is a rule across
 * the page, and content.
 */
export function spacingRow(image: DecodedImage, y: number, above: number, below: number): boolean {
  const row = words(image, y, 0, image.width);
  if (row.some((word) => word !== row[0])) return false;
  return [above, below].some((at) => at >= 0 && at < image.height && backgroundOf(words(image, at, 0, image.width)) === row[0]);
}

/** Blank columns in a row that part two words; fewer part two letters. */
const WORD_SPACE = 3;

/**
 * Columns `from` to `to` moved out to the space before and after the word at
 * each edge on `rows`: a region starts at the first pixel that differs, which
 * is often inside a word. An edge with no space within `reach` stays put.
 */
export function blankColumns(
  image: DecodedImage,
  rows: readonly number[],
  from: number,
  to: number,
  reach: number,
): [number, number] {
  // The background is what most of the stretch the walk may cover is: the
  // region's own columns can be mostly the change.
  const lines = rows.map((y) => {
    const row = words(image, y, 0, image.width);
    return { row, background: backgroundOf(row.subarray(Math.max(0, from - reach), Math.min(row.length, to + reach))) };
  });
  const busy = (x: number) => lines.some(({ row, background }) => row[x] !== background);
  // Walk out from the edge, past each letter, until a word's space of blank
  // columns; the edge lands on the last letter before it.
  const out = (edge: number, step: -1 | 1): number => {
    let last = step < 0 ? edge : edge - 1;
    let blank = 0;
    for (let x = last + step, moved = 0; x >= 0 && x < image.width; x += step, moved += 1) {
      if (moved === reach) return edge;
      if (busy(x)) [last, blank] = [x, 0];
      else if ((blank += 1) === WORD_SPACE) break;
    }
    return step < 0 ? last : last + 1;
  };
  return [Math.min(from, out(from, -1)), Math.max(to, out(to, 1))];
}
