/**
 * Every policy's verdict on two images, in one scan.
 *
 * `pixelmatch` takes two equally sized images and writes a third, so a
 * comparison that aligned its rows had to copy the before image into the after
 * image's rows first, and a comparison under two policies ran it twice, each
 * time into a full RGBA buffer whose alpha channel was the only thing read
 * back. This is the same arithmetic — `pixelmatch` 7's colour delta, its
 * anti-aliasing detector and its drawing, line for line — over a table of rows
 * instead of a copy, judging each differing pixel once for every policy.
 *
 * Parity with `pixelmatch` is the contract, not an approximation of it: the
 * verdict is the product, and a verdict that moved with the kernel would be a
 * difference this package invented. `judge.test.ts` holds the two to the same
 * counts and the same pixels.
 */

import type { DiffPolicy } from '@variance-authority/raster';
import type { DecodedImage } from './mask.js';

/** What a scan writes besides the counts. */
export interface JudgeOutput {
  /** One byte per pixel, 1 where this policy (by index) counted a difference. */
  readonly mask?: number;
  /** `pixelmatch`'s own picture, for this policy (by index). */
  readonly picture?: { readonly policy: number; readonly diffMask: boolean };
}

export interface Judged {
  /** Pixels each policy called different, in the order the policies came. */
  readonly changed: number[];
  readonly mask?: Uint8Array;
  readonly picture?: Uint8Array;
}

/**
 * Judge `after` against `before` on the after image's canvas.
 *
 * `source[y]` is the before row that shows after row `y`'s content, or `-1`
 * for a row with no partner, which is compared with itself and so counts
 * nothing; the caller marks it. Without `source` the two are compared position
 * by position and must already be the same size.
 */
export function judgeRows(
  before: DecodedImage,
  after: DecodedImage,
  source: ArrayLike<number> | undefined,
  policies: readonly DiffPolicy[],
  output: JudgeOutput = {},
): Judged {
  const { width, height } = after;
  const row = width * 4;
  const was = bytes(before.data);
  const now = bytes(after.data);
  const was32 = new Uint32Array(was.buffer, was.byteOffset, was.length >> 2);
  const now32 = new Uint32Array(now.buffer, now.byteOffset, now.length >> 2);

  // Each canvas row of the first image, as a view: the before row it pairs
  // with, or the after row itself where it pairs with none.
  const first8: Uint8Array[] = [];
  const first32: Uint32Array[] = [];
  const second8: Uint8Array[] = [];
  const second32: Uint32Array[] = [];
  for (let y = 0; y < height; y += 1) {
    const from = source === undefined ? y : source[y]!;
    const [bytes8, words] = from < 0 ? [now, now32] : [was, was32];
    const at = from < 0 ? y : from;
    first8.push(bytes8.subarray(at * row, (at + 1) * row));
    first32.push(words.subarray(at * width, (at + 1) * width));
    second8.push(now.subarray(y * row, (y + 1) * row));
    second32.push(now32.subarray(y * width, (y + 1) * width));
  }

  const limits = policies.map((policy) => 35215 * policy.threshold * policy.threshold);
  const changed = policies.map(() => 0);
  const mask = output.mask === undefined ? undefined : new Uint8Array(width * height);
  const picture = output.picture === undefined ? undefined : new Uint8Array(height * row);
  const drawn = output.picture?.policy ?? -1;
  const greyed = output.picture !== undefined && !output.picture.diffMask;

  for (let y = 0; y < height; y += 1) {
    const a8 = first8[y]!;
    const a32 = first32[y]!;
    const b8 = second8[y]!;
    const b32 = second32[y]!;
    for (let x = 0; x < width; x += 1) {
      const at = x * 4;
      const pos = y * row + at;
      if (a32[x] === b32[x]) {
        if (greyed) grey(a8, at, picture!, pos);
        continue;
      }
      const delta = colorDelta(a8, b8, at, pos);
      const size = Math.abs(delta);
      // Anti-aliasing is a fact about the two images, asked once and shared by
      // every policy that forgives it.
      let excused: boolean | undefined;
      for (let index = 0; index < policies.length; index += 1) {
        if (!(size > limits[index]!)) {
          if (index === drawn && greyed) grey(a8, at, picture!, pos);
          continue;
        }
        if (!policies[index]!.includeAA) {
          excused ??=
            antialiased(first8, x, y, width, height, first32, second32) ||
            antialiased(second8, x, y, width, height, second32, first32);
          if (excused) {
            if (index === drawn && greyed) paint(picture!, pos, 255, 255, 0);
            continue;
          }
        }
        changed[index]! += 1;
        if (index === output.mask) mask![y * width + x] = 1;
        if (index === drawn) paint(picture!, pos, 255, 0, 0);
      }
    }
  }

  return { changed, ...(mask === undefined ? {} : { mask }), ...(picture === undefined ? {} : { picture }) };
}

/** Bytes whose offset a word view can start at: copied only when it cannot. */
function bytes(data: Uint8Array): Uint8Array {
  return data.byteOffset % 4 === 0 ? data : new Uint8Array(data);
}

/**
 * `pixelmatch`'s anti-aliasing detector (Vysniauskas, 2009), over row views.
 *
 * `rows` is the image whose pixel is asked about; `own` and `other` are both
 * images as words, the first being `rows`'.
 */
function antialiased(
  rows: readonly Uint8Array[],
  x1: number,
  y1: number,
  width: number,
  height: number,
  own: readonly Uint32Array[],
  other: readonly Uint32Array[],
): boolean {
  const x0 = Math.max(x1 - 1, 0);
  const y0 = Math.max(y1 - 1, 0);
  const x2 = Math.min(x1 + 1, width - 1);
  const y2 = Math.min(y1 + 1, height - 1);
  const centre = rows[y1]!;
  const at = x1 * 4;
  const pos = (y1 * width + x1) * 4;
  const r1 = centre[at]!;
  const g1 = centre[at + 1]!;
  const b1 = centre[at + 2]!;
  const a1 = centre[at + 3]!;
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
  let min = 0;
  let max = 0;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;

  for (let x = x0; x <= x2; x += 1) {
    for (let y = y0; y <= y2; y += 1) {
      if (x === x1 && y === y1) continue;
      const delta = brightnessDelta(rows[y]!, x * 4, pos, r1, g1, b1, a1);
      if (delta === 0) {
        zeroes += 1;
        if (zeroes > 2) return false;
      } else if (delta < min) {
        min = delta;
        minX = x;
        minY = y;
      } else if (delta > max) {
        max = delta;
        maxX = x;
        maxY = y;
      }
    }
  }

  if (min === 0 || max === 0) return false;
  return (
    (manySiblings(own, minX, minY, width, height) && manySiblings(other, minX, minY, width, height)) ||
    (manySiblings(own, maxX, maxY, width, height) && manySiblings(other, maxX, maxY, width, height))
  );
}

/** Three or more of a pixel's neighbours are the same colour as it. */
function manySiblings(rows: readonly Uint32Array[], x1: number, y1: number, width: number, height: number): boolean {
  const x0 = Math.max(x1 - 1, 0);
  const y0 = Math.max(y1 - 1, 0);
  const x2 = Math.min(x1 + 1, width - 1);
  const y2 = Math.min(y1 + 1, height - 1);
  const value = rows[y1]![x1];
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;

  for (let x = x0; x <= x2; x += 1) {
    for (let y = y0; y <= y2; y += 1) {
      if (x === x1 && y === y1) continue;
      zeroes += +(value === rows[y]![x]);
      if (zeroes > 2) return true;
    }
  }
  return false;
}

/**
 * The squared YIQ distance (Kotsarenko and Ramos), negative where the second
 * pixel is darker. `pos` is the pixel's offset on the canvas, which is where
 * `pixelmatch`'s checkerboard is read, whichever row the first pixel came from.
 */
function colorDelta(first: Uint8Array, second: Uint8Array, at: number, pos: number): number {
  const r1 = first[at]!;
  const g1 = first[at + 1]!;
  const b1 = first[at + 2]!;
  const a1 = first[at + 3]!;
  const r2 = second[at]!;
  const g2 = second[at + 1]!;
  const b2 = second[at + 2]!;
  const a2 = second[at + 3]!;

  let dr = r1 - r2;
  let dg = g1 - g2;
  let db = b1 - b2;
  const da = a1 - a2;

  if (a1 < 255 || a2 < 255) {
    const [rb, gb, bb] = checkerboard(pos);
    dr = (r1 * a1 - r2 * a2 - rb * da) / 255;
    dg = (g1 * a1 - g2 * a2 - gb * da) / 255;
    db = (b1 * a1 - b2 * a2 - bb * da) / 255;
  }

  const y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
  const i = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189;
  const q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;
  const delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
  return y > 0 ? -delta : delta;
}

function brightnessDelta(
  row: Uint8Array,
  at: number,
  pos: number,
  r1: number,
  g1: number,
  b1: number,
  a1: number,
): number {
  const r2 = row[at]!;
  const g2 = row[at + 1]!;
  const b2 = row[at + 2]!;
  const a2 = row[at + 3]!;

  let dr = r1 - r2;
  let dg = g1 - g2;
  let db = b1 - b2;
  const da = a1 - a2;
  if (!dr && !dg && !db && !da) return 0;

  if (a1 < 255 || a2 < 255) {
    const [rb, gb, bb] = checkerboard(pos);
    dr = (r1 * a1 - r2 * a2 - rb * da) / 255;
    dg = (g1 * a1 - g2 * a2 - gb * da) / 255;
    db = (b1 * a1 - b2 * a2 - bb * da) / 255;
  }
  return dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
}

/** The background `pixelmatch` blends a translucent pixel onto, by offset. */
function checkerboard(pos: number): readonly [number, number, number] {
  return [
    48 + 159 * (pos % 2),
    48 + 159 * (((pos / 1.618033988749895) | 0) % 2),
    48 + 159 * (((pos / 2.618033988749895) | 0) % 2),
  ];
}

function paint(picture: Uint8Array, pos: number, red: number, green: number, blue: number): void {
  picture[pos] = red;
  picture[pos + 1] = green;
  picture[pos + 2] = blue;
  picture[pos + 3] = 255;
}

/** The first image, dimmed to a tenth over white: `pixelmatch`'s background. */
function grey(row: Uint8Array, at: number, picture: Uint8Array, pos: number): void {
  const luminance = row[at]! * 0.29889531 + row[at + 1]! * 0.58662247 + row[at + 2]! * 0.11448223;
  const value = 255 + ((luminance - 255) * 0.1 * row[at + 3]!) / 255;
  paint(picture, pos, value, value, value);
}
