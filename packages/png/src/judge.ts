/**
 * Every policy's verdict on two images, in one scan: `pixelmatch` 7's colour
 * delta, anti-aliasing detector and drawing, line for line, over a table of
 * rows rather than a copy of the before image in the after image's order.
 * Parity with `pixelmatch` is the contract, held by `judge.test.ts`; the one
 * departure is a seam, where a before pixel's anti-aliasing is read from the
 * rows around the one it came from, not the rows the alignment set beside it.
 */

import { type DiffPolicy, SEVERITY_LEVELS } from '@variance-authority/raster';
import type { DecodedImage } from './mask.js';

/** What a scan writes besides the counts. */
export interface JudgeOutput {
  /** One byte per pixel where this policy (by index) counted a difference: its grade ({@link SEVERITY_LEVELS}). */
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

/** Columns `from` up to `to`, and for each after row the before row it shows there. */
export interface SourceStrip {
  readonly from: number;
  readonly to: number;
  readonly source: ArrayLike<number>;
}

/**
 * Judge `after` against `before` on the after image's canvas.
 *
 * Each strip's `source[y]` is the before row that shows after row `y`'s content
 * across the strip's columns, or `-1` for a row with no partner, which is
 * compared with itself and so counts nothing; the caller marks it. The strips
 * tile the width. Without them the two are compared position by position and
 * must already be the same size.
 */
export function judgeRows(
  before: DecodedImage,
  after: DecodedImage,
  strips: readonly SourceStrip[] | undefined,
  policies: readonly DiffPolicy[],
  output: JudgeOutput = {},
): Judged {
  const { width, height } = after;
  const row = width * 4;
  const was = bytes(before.data);
  const now = bytes(after.data);
  const was32 = new Uint32Array(was.buffer, was.byteOffset, was.length >> 2);
  const now32 = new Uint32Array(now.buffer, now.byteOffset, now.length >> 2);

  const second8: Uint8Array[] = [];
  const second32: Uint32Array[] = [];
  for (let y = 0; y < height; y += 1) {
    second8.push(now.subarray(y * row, (y + 1) * row));
    second32.push(now32.subarray(y * width, (y + 1) * width));
  }
  const was8 = (at: number) => was.subarray(at * row, (at + 1) * row);
  const was32row = (at: number) => was32.subarray(at * width, (at + 1) * width);
  const canvas = (y: number): Window => {
    const second: Window = { bytes: [], words: [] };
    for (let d = -2; d <= 2; d += 1) {
      const outside = y + d < 0 || y + d >= height;
      second.bytes.push(outside ? undefined : second8[y + d]);
      second.words.push(outside ? undefined : second32[y + d]);
    }
    return second;
  };

  const limits = policies.map((policy) => limitOf(policy.threshold));
  const grades = SEVERITY_LEVELS.map(limitOf);
  const changed = policies.map(() => 0);
  const mask = output.mask === undefined ? undefined : new Uint8Array(width * height);
  const picture = output.picture === undefined ? undefined : new Uint8Array(height * row);
  const drawn = output.picture?.policy ?? -1;
  const greyed = output.picture !== undefined && !output.picture.diffMask;

  for (const { from: x0, to: x1, source } of strips ?? [{ from: 0, to: width, source: undefined }]) {
    // Each canvas row of the first image, as a view: the before row it pairs
    // with, or the after row itself where it pairs with none.
    const first8: Uint8Array[] = [];
    const first32: Uint32Array[] = [];
    for (let y = 0; y < height; y += 1) {
      const from = source === undefined ? y : source[y]!;
      const [bytes8, words] = from < 0 ? [now, now32] : [was, was32];
      const at = from < 0 ? y : from;
      first8.push(bytes8.subarray(at * row, (at + 1) * row));
      first32.push(words.subarray(at * width, (at + 1) * width));
    }

    // The rows two each way around a pixel, read in the image the row came
    // from and to that image's edge: across a seam of paired runs, the canvas
    // sets before rows side by side that never were.
    const near = (y: number): Window => {
      const from = source === undefined ? y : source[y]!;
      const first: Window = { bytes: [], words: [] };
      for (let d = -2; d <= 2; d += 1) {
        const at = y + d;
        const was = from < 0 ? at : from + d;
        const outside = from < 0 ? at < 0 || at >= height : was < 0 || was >= before.height;
        first.bytes.push(outside ? undefined : from < 0 ? first8[at] : was8(was));
        first.words.push(outside ? undefined : from < 0 ? first32[at] : was32row(was));
      }
      return first;
    };
    let windows: { y: number; first: Window; second: Window } | undefined;

    for (let y = 0; y < height; y += 1) {
      const a8 = first8[y]!;
      const a32 = first32[y]!;
      const b8 = second8[y]!;
      const b32 = second32[y]!;
      for (let x = x0; x < x1; x += 1) {
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
            if (windows?.y !== y) windows = { y, first: near(y), second: canvas(y) };
            excused ??=
              antialiased(windows.first, x, pos, width, windows.second) ||
              antialiased(windows.second, x, pos, width, windows.first);
            if (excused) {
              if (index === drawn && greyed) paint(picture!, pos, 255, 255, 0);
              continue;
            }
          }
          changed[index]! += 1;
          if (index === output.mask) {
            let grade = 1;
            while (grade < grades.length && size > grades[grade]!) grade += 1;
            mask![y * width + x] = grade;
          }
          if (index === drawn) paint(picture!, pos, 255, 0, 0);
        }
      }
    }
  }

  return { changed, ...(mask === undefined ? {} : { mask }), ...(picture === undefined ? {} : { picture }) };
}

/** Bytes whose offset a word view can start at: copied only when it cannot. */
function bytes(data: Uint8Array): Uint8Array {
  return data.byteOffset % 4 === 0 ? data : new Uint8Array(data);
}

/** Five rows centred on a pixel's, `undefined` past the image's edge. */
interface Window {
  readonly bytes: (Uint8Array | undefined)[];
  readonly words: (Uint32Array | undefined)[];
}

/**
 * `pixelmatch`'s anti-aliasing detector (Vysniauskas, 2009), over the rows
 * around a pixel: `own` is the image whose pixel, at the centre row, is asked
 * about, and `other` the other image's rows at the same places. `pos` is the
 * pixel's offset on the canvas, where the checkerboard is read.
 */
function antialiased(own: Window, x1: number, pos: number, width: number, other: Window): boolean {
  const x0 = Math.max(x1 - 1, 0);
  const x2 = Math.min(x1 + 1, width - 1);
  const centre = own.bytes[2]!;
  const at = x1 * 4;
  const r1 = centre[at]!;
  const g1 = centre[at + 1]!;
  const b1 = centre[at + 2]!;
  const a1 = centre[at + 3]!;
  let zeroes = x1 === x0 || x1 === x2 || own.bytes[1] === undefined || own.bytes[3] === undefined ? 1 : 0;
  let min = 0;
  let max = 0;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;

  for (let x = x0; x <= x2; x += 1) {
    for (let y = 1; y <= 3; y += 1) {
      const row = own.bytes[y];
      if (row === undefined || (x === x1 && y === 2)) continue;
      const delta = brightnessDelta(row, x * 4, pos, r1, g1, b1, a1);
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
    (manySiblings(own.words, minX, minY, width) && manySiblings(other.words, minX, minY, width)) ||
    (manySiblings(own.words, maxX, maxY, width) && manySiblings(other.words, maxX, maxY, width))
  );
}

/** Three or more of a pixel's neighbours are the same colour as it; `y1` indexes `rows`. */
function manySiblings(rows: readonly (Uint32Array | undefined)[], x1: number, y1: number, width: number): boolean {
  const x0 = Math.max(x1 - 1, 0);
  const x2 = Math.min(x1 + 1, width - 1);
  const centre = rows[y1];
  if (centre === undefined) return false;
  const value = centre[x1];
  let zeroes = x1 === x0 || x1 === x2 || rows[y1 - 1] === undefined || rows[y1 + 1] === undefined ? 1 : 0;

  for (let x = x0; x <= x2; x += 1) {
    for (let y = y1 - 1; y <= y1 + 1; y += 1) {
      const row = rows[y];
      if (row === undefined || (x === x1 && y === y1)) continue;
      zeroes += +(value === row[x]);
      if (zeroes > 2) return true;
    }
  }
  return false;
}

/** The squared YIQ distance past which a pixel differs under `threshold`: `pixelmatch`'s `35215 · threshold²`. */
export function limitOf(threshold: number): number {
  return 35215 * threshold * threshold;
}

/**
 * The squared YIQ distance (Kotsarenko and Ramos), negative where the second
 * pixel is darker. `pos` is the pixel's offset on the canvas, which is where
 * `pixelmatch`'s checkerboard is read, whichever row the first pixel came from.
 */
export function colorDelta(first: Uint8Array, second: Uint8Array, at: number, pos: number): number {
  rgbDelta(first[at]!, first[at + 1]!, first[at + 2]!, first[at + 3]!, second, at, pos);
  const dr = DELTA[0]!;
  const dg = DELTA[1]!;
  const db = DELTA[2]!;
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
  if (r1 === row[at] && g1 === row[at + 1] && b1 === row[at + 2] && a1 === row[at + 3]) return 0;
  rgbDelta(r1, g1, b1, a1, row, at, pos);
  return DELTA[0]! * 0.29889531 + DELTA[1]! * 0.58662247 + DELTA[2]! * 0.11448223;
}

/** The channel differences {@link rgbDelta} writes, reused so a pixel allocates nothing. */
const DELTA = new Float64Array(3);

/** One pixel's difference from another's, blended onto the checkerboard where either is translucent. */
function rgbDelta(r1: number, g1: number, b1: number, a1: number, row: Uint8Array, at: number, pos: number): void {
  const r2 = row[at]!;
  const g2 = row[at + 1]!;
  const b2 = row[at + 2]!;
  const a2 = row[at + 3]!;
  if (a1 < 255 || a2 < 255) {
    const da = a1 - a2;
    const [rb, gb, bb] = checkerboard(pos);
    DELTA[0] = (r1 * a1 - r2 * a2 - rb * da) / 255;
    DELTA[1] = (g1 * a1 - g2 * a2 - gb * da) / 255;
    DELTA[2] = (b1 * a1 - b2 * a2 - bb * da) / 255;
  } else {
    DELTA[0] = r1 - r2;
    DELTA[1] = g1 - g2;
    DELTA[2] = b1 - b2;
  }
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
