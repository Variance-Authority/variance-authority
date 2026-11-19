/**
 * Two columns of rows paired: the shortest edit between their runs of
 * identical rows, laid out as which before row each after row shows.
 */

import type { RowSpan } from '@variance-authority/raster';
import type { PairedRows } from './align.js';
import { edits, type Edit } from './edit-script.js';
import { inPlace } from './in-place.js';
import type { DecodedImage } from './mask.js';
import { straddled } from './straddle.js';

/**
 * A pairing of two columns of rows, and what it and position leave differing.
 *
 * `paired` counts every pixel that differs exactly between the rows it pairs,
 * and every pixel of a row it leaves unpaired, inserted or removed, white or not,
 * since an inserted row is marked in full and a removal is weighed by its rows
 * times the width. Charging a removed white row nothing would let a pairing
 * remove one, grow a run one row lower and shift everything between for free.
 * `positional` counts on the union box, every pixel that differs from the row at
 * the same height, white where an image has no row. It stops counting once it
 * passes `paired`. Rows in the shared head are equal under both and are not read.
 */
export interface Weighed {
  readonly rows: PairedRows;
  readonly paired: number;
  readonly positional: number;
}

export function pairWords(
  was: Uint32Array,
  now: Uint32Array,
  beforeHeight: number,
  afterHeight: number,
  width: number,
  limit: number,
): Weighed {
  // The rows the two share at the top and at the bottom, read by comparing
  // them, which costs less than hashing them: two captures of one page are
  // mostly that, and two captures of an unchanged page are only that.
  const shorter = Math.min(beforeHeight, afterHeight);
  let head = 0;
  while (head < shorter && same(was, head, now, head, width)) head += 1;
  let tail = 0;
  while (
    tail < shorter - head &&
    same(was, beforeHeight - 1 - tail, now, afterHeight - 1 - tail, width)
  ) {
    tail += 1;
  }
  // A run of identical rows the head ends inside of is handed back to the
  // middle whole, and so is one the tail starts inside of: a gap that grew is
  // one run that got longer, and it has to be seen as one.
  while (
    head > 0 &&
    ((head < beforeHeight && same(was, head - 1, was, head, width)) ||
      (head < afterHeight && same(now, head - 1, now, head, width)))
  ) {
    head -= 1;
  }
  while (
    tail > 0 &&
    ((beforeHeight - tail > head && same(was, beforeHeight - tail - 1, was, beforeHeight - tail, width)) ||
      (afterHeight - tail > head && same(now, afterHeight - tail - 1, now, afterHeight - tail, width)))
  ) {
    tail -= 1;
  }

  const left = runsOf(hashRows(was, width, beforeHeight, head, tail));
  const right = runsOf(hashRows(now, width, afterHeight, head, tail));
  const script = edits(left.hash, right.hash, limit);

  const cost = (from: number, to: number): number => differing(was, from, now, to, width);
  const initial = pairing(left, right, script, afterHeight, cost);
  // What each after row's pairing leaves differing, read once: the fractional
  // pass and the weighing both need it. A head or tail row is its own copy.
  const costs = new Int32Array(afterHeight);
  const lift = afterHeight - beforeHeight;
  for (let y = 0; y < afterHeight; y += 1) {
    const from = initial.source[y]!;
    const copied = (y < head && from === y) || (y >= afterHeight - tail && from === y - lift);
    costs[y] = from < 0 ? width : copied ? 0 : cost(from, y);
  }
  const rows = inPlace(straddled(initial, was, now, beforeHeight, width, cost, costs), was, now, beforeHeight, width, cost, costs);

  let paired = 0;
  for (let y = head; y < afterHeight; y += 1) paired += costs[y]!;
  for (const span of rows.removed) paired += (span.to - span.from) * width;

  let positional = 0;
  for (let y = head; y < Math.max(beforeHeight, afterHeight) && positional <= paired; y += 1) {
    if (y >= beforeHeight) positional += width - matching(now, y, WHITE, width);
    else if (y >= afterHeight) positional += width - matching(was, y, WHITE, width);
    else positional += differing(was, y, now, y, width);
  }
  return { rows, paired, positional };
}

/**
 * Whether the pairing leaves fewer pixels differing than position does.
 *
 * The shortest edit counts runs, not pixels. Where a line changed in place, a
 * row beside it that matches a row at another height is a shorter edit than the
 * substitution, and pairing on it shifts everything around it: a mark that went
 * from beside two lines of text becomes two whole lines compared against their
 * neighbours. So the pairing is weighed by what it leaves for the comparison
 * ({@link Weighed}). A tie goes to whichever moved nothing: the pairing when it
 * shifted no row and only says where rows came or went, else position. A
 * pairing that moved nothing and says nothing came or went is position, and
 * stands for it only where nothing differs: two equal captures.
 */
export function explains({ rows, paired, positional }: Weighed): boolean {
  if (paired > 0 && rows.shifted.length === 0 && rows.inserted.length === 0 && rows.removed.length === 0) return false;
  return paired < positional || (paired === positional && rows.shifted.length === 0);
}

function differing(left: Uint32Array, leftRow: number, right: Uint32Array, rightRow: number, width: number): number {
  return differingIn(left, leftRow, right, rightRow, width, 0, width);
}

/** The pixels that differ between two rows, in columns `from` up to `to`. */
export function differingIn(
  left: Uint32Array,
  leftRow: number,
  right: Uint32Array,
  rightRow: number,
  width: number,
  from: number,
  to: number,
): number {
  const l = leftRow * width;
  const r = rightRow * width;
  let count = 0;
  for (let x = from; x < to; x += 1) if (left[l + x] !== right[r + x]) count += 1;
  return count;
}

function matching(words: Uint32Array, row: number, word: number, width: number): number {
  let count = 0;
  for (let index = row * width, end = index + width; index < end; index += 1) if (words[index] === word) count += 1;
  return count;
}

/** Every channel at 255, whichever way the bytes are read. */
const WHITE = 0xffffffff;

/** Rows of identical pixels, as one token each: the hash, where it starts and how many. */
interface Runs {
  readonly hash: Float64Array;
  readonly start: Int32Array;
  readonly length: Int32Array;
}

function runsOf(rows: Float64Array): Runs {
  const hash = new Float64Array(rows.length);
  const start = new Int32Array(rows.length);
  const length = new Int32Array(rows.length);
  let count = 0;

  for (let y = 0; y < rows.length; y += 1) {
    if (count > 0 && hash[count - 1] === rows[y]) {
      length[count - 1]! += 1;
      continue;
    }
    hash[count] = rows[y]!;
    start[count] = y;
    length[count] = 1;
    count += 1;
  }

  return { hash: hash.subarray(0, count), start, length };
}

/**
 * The pixels as one 32-bit word each, without a copy when the bytes allow it.
 * A fully transparent pixel reads as 0 whatever colour it carries: a kept WebP
 * drops that colour, no comparison sees it, so neither may a row's identity.
 * The words are little-endian, so alpha is the top byte.
 */
export function wordsOf({ width, height, data }: DecodedImage): Uint32Array {
  const words =
    data.byteOffset % 4 === 0
      ? new Uint32Array(data.buffer, data.byteOffset, width * height)
      : new Uint32Array(Uint8Array.from(data).buffer);
  // A loop rather than `findIndex`: a callback per pixel was most of the cost.
  let cleared: Uint32Array | undefined;
  for (let index = 0; index < words.length; index += 1) {
    if (!hidden(words[index]!)) continue;
    // Never written over the caller's pixels: a view is copied first.
    cleared ??= words.buffer === data.buffer ? words.slice() : words;
    cleared[index] = 0;
  }
  return cleared ?? words;
}

/** A fully transparent pixel that still carries a colour. */
function hidden(word: number): boolean {
  return word !== 0 && word < 0x01000000;
}

function same(left: Uint32Array, leftRow: number, right: Uint32Array, rightRow: number, width: number): boolean {
  const from = leftRow * width;
  const to = rightRow * width;
  for (let x = 0; x < width; x += 1) if (left[from + x] !== right[to + x]) return false;
  return true;
}

/**
 * One number per row, from two 32-bit hashes folded into the 53 bits a double
 * holds exactly. A collision pairs two different rows, and the pixel comparison
 * that follows finds them different, so it costs precision and never a miss.
 *
 * The shared head and tail are not hashed. Each of their rows gets a negative
 * number of its own, the same on both sides, so they pair with each other and
 * with nothing else.
 */
function hashRows(words: Uint32Array, width: number, height: number, head: number, tail: number): Float64Array {
  const out = new Float64Array(height);

  for (let y = 0; y < height; y += 1) {
    if (y < head) {
      out[y] = -1 - y;
      continue;
    }
    if (y >= height - tail) {
      out[y] = -0x100000000 - (height - y);
      continue;
    }
    let first = 0x811c9dc5;
    let second = 0x9747b28c;
    for (let index = y * width, end = index + width; index < end; index += 1) {
      const word = words[index]!;
      first = Math.imul(first ^ word, 0x01000193);
      second = Math.imul(second ^ word, 0x5bd1e995);
      second ^= second >>> 13;
    }
    out[y] = (first >>> 0) * 0x200000 + ((second >>> 0) & 0x1fffff);
  }

  return out;
}

/**
 * The script, as rows: a kept run pairs row for row and what it grew or lost is
 * inserted or removed; a rewritten band between kept runs pairs by position,
 * from its top or its bottom, whichever leaves fewer pixels differing, and what
 * it cannot pair is removed or inserted.
 */
function pairing(
  left: Runs,
  right: Runs,
  script: readonly Edit[],
  height: number,
  cost: (beforeRow: number, afterRow: number) => number,
): PairedRows {
  const source = new Int32Array(height).fill(-1);
  const inserted: RowSpan[] = [];
  const removed: { from: number; to: number; at: number }[] = [];
  const grown: RowSpan[] = [];
  const shrunk: { from: number; to: number; at: number }[] = [];
  const shifted: { from: number; to: number; by: number }[] = [];

  const pair = (beforeFrom: number, afterFrom: number, rows: number): void => {
    if (rows <= 0) return;
    for (let row = 0; row < rows; row += 1) source[afterFrom + row] = beforeFrom + row;
    const by = afterFrom - beforeFrom;
    if (by === 0) return;
    const last = shifted.at(-1);
    if (last !== undefined && last.to === afterFrom && last.by === by) shifted[shifted.length - 1] = { ...last, to: afterFrom + rows };
    else shifted.push({ from: afterFrom, to: afterFrom + rows, by });
  };

  const insert = (from: number, to: number): void => {
    const last = inserted.at(-1);
    if (last !== undefined && last.to === from) inserted[inserted.length - 1] = { from: last.from, to };
    else inserted.push({ from, to });
  };

  // The band being gathered: before rows and after rows, each contiguous, and
  // the rows a run it opened with grew or lost, if it did.
  let band:
    | { beforeFrom: number; beforeTo: number; afterFrom: number; afterTo: number; grown: number; shrunk: number }
    | undefined;
  const settle = (): void => {
    if (band === undefined) return;
    const { beforeFrom, beforeTo, afterTo } = band;
    if (band.grown > 0) {
      insert(band.afterFrom, band.afterFrom + band.grown);
      grown.push({ from: band.afterFrom, to: band.afterFrom + band.grown });
    }
    const afterFrom = band.afterFrom + band.grown;
    // A run that only got shorter, with nothing else in the band: the rows it lost.
    if (band.shrunk > 0 && afterFrom === afterTo && beforeTo - beforeFrom === band.shrunk) {
      shrunk.push({ from: beforeFrom, to: beforeTo, at: afterTo });
    }
    const rows = Math.min(beforeTo - beforeFrom, afterTo - afterFrom);
    let bottom = false;
    if (rows > 0 && beforeTo - beforeFrom !== afterTo - afterFrom) {
      let fromTop = 0;
      let fromBottom = 0;
      for (let row = 0; row < rows; row += 1) {
        fromTop += cost(beforeFrom + row, afterFrom + row);
        fromBottom += cost(beforeTo - rows + row, afterTo - rows + row);
      }
      bottom = fromBottom < fromTop;
    }
    if (bottom) {
      pair(beforeTo - rows, afterTo - rows, rows);
      if (afterFrom < afterTo - rows) insert(afterFrom, afterTo - rows);
      if (beforeFrom < beforeTo - rows) removed.push({ from: beforeFrom, to: beforeTo - rows, at: afterFrom });
    } else {
      pair(beforeFrom, afterFrom, rows);
      if (afterFrom + rows < afterTo) insert(afterFrom + rows, afterTo);
      if (beforeFrom + rows < beforeTo) removed.push({ from: beforeFrom + rows, to: beforeTo, at: afterTo });
    }
    band = undefined;
  };

  let afterAt = 0;
  let beforeAt = 0;
  for (const edit of script) {
    if (edit[0] === '=') {
      settle();
      const [, i, j] = edit;
      const was = left.length[i]!;
      const now = right.length[j]!;
      const kept = Math.min(was, now);
      pair(left.start[i]!, right.start[j]!, kept);
      beforeAt = left.start[i]! + was;
      afterAt = right.start[j]! + now;
      if (was !== now) {
        band = {
          beforeFrom: left.start[i]! + kept,
          beforeTo: beforeAt,
          afterFrom: right.start[j]! + kept,
          afterTo: afterAt,
          grown: now - kept,
          shrunk: was - kept,
        };
      }
      continue;
    }
    band ??= { beforeFrom: beforeAt, beforeTo: beforeAt, afterFrom: afterAt, afterTo: afterAt, grown: 0, shrunk: 0 };
    if (edit[0] === '-') {
      band.beforeTo = left.start[edit[1]]! + left.length[edit[1]]!;
      beforeAt = band.beforeTo;
    } else {
      band.afterTo = right.start[edit[1]]! + right.length[edit[1]]!;
      afterAt = band.afterTo;
    }
  }
  settle();

  return { source, inserted, removed, shifted, grown, shrunk };
}
