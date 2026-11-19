import type { RowAlignment, RowSpan } from '@variance-authority/raster';
import type { DecodedImage } from './mask.js';
import { edits, type Edit } from './edit-script.js';
import { straddled } from './straddle.js';

/**
 * Which row of the before image each row of the after image shows.
 *
 * A full-page capture is a column of rows, and the content of a document flows:
 * a paragraph inserted near the top pushes everything under it down. Compared
 * position by position, every row under the insertion sits against the row that
 * used to be there, and a 1,155-pixel insertion paints the whole tail of a
 * 45,000-pixel page as changed. A reviewer then sees one change as the entire
 * page, and the regions under it are attributed to every node it pushed.
 *
 * So the rows are diffed the way lines of text are. Each row is hashed, runs of
 * identical rows become one token, and Myers' algorithm finds the shortest edit
 * between the two token columns. The result is a pairing, not a verdict: the
 * caller still compares each after row with the before row it is paired with,
 * pixel by pixel, and every row that moved, came or went is itself a change, so
 * no pairing can make a page read as unchanged. A row with no partner is
 * reported, never paired with white. Where two paired runs meet, the before
 * rows on either side were not neighbours, so the comparison reads each before
 * pixel's anti-aliasing from the rows around the one it came from.
 *
 * Myers is O((N+M)·D) in time and keeps O(D²) of trace, where N and M count runs
 * rather than rows and D is the size of the edit in runs. A page's runs are
 * about two thirds of its rows, and an insertion is one edit once the common
 * head and tail are trimmed, so an ordinary change costs one hashing pass. D
 * grows with every edit on the page, not only the largest: a rewritten section
 * and the lines it reflowed further down came to 3,031 runs on a 28,519-row
 * page. Past `limit` the search stops and the columns are split at runs each
 * side holds once ({@link edits}), so the rows an edit only moved still pair,
 * and a stretch that shares no such run, or that the split reaches after
 * spending its work bound, is compared by position within it.
 *
 * A page whose columns move apart, a sidebar that stays put beside a main
 * column that grew, moves no whole row: every row under the insertion holds the
 * sidebar's row at that height and the main column's from higher up. So where
 * the whole-width pairing still leaves pixels differing, the columns that differ
 * by position are split from the ones that do not, each strip is paired on its
 * own, and the strips are kept when they leave fewer pixels differing in all.
 */
export interface AlignedRows extends RowAlignment {
  /**
   * The pairing of each vertical strip, left to right, tiling the width. One
   * strip across the whole width is a page whose rows moved whole, and its spans
   * carry no `columns`; with more, each span says which strip's columns it covers.
   */
  readonly strips: readonly AlignedStrip[];
}

/** One strip's pairing: columns `from` up to, and not including, `to`. */
export interface AlignedStrip extends PairedRows {
  readonly from: number;
  readonly to: number;
}

/** Which before row each after row shows, across the columns it was paired on. */
export interface PairedRows extends RowAlignment {
  /** For each after row, the before row it is compared against, or `-1` for none. */
  readonly source: Int32Array;
  /**
   * The inserted rows that repeat the run of identical rows they grew: a gap or a
   * padding that got taller. They add no content; they move what follows.
   */
  readonly grown: readonly RowSpan[];
  /** The removed rows a run of identical rows lost, the other way round. */
  readonly shrunk: readonly (RowSpan & { readonly at: number })[];
}

/** The rounds, in runs, one Myers search takes before the columns are split at runs each side holds once. */
export const ALIGNMENT_LIMIT = 2000;

/**
 * The pairing, or `undefined` when there is none to make: the widths differ, so
 * no row of one is a row of the other, or no pairing, whole or in strips, leaves
 * fewer pixels differing than position does.
 */
export function alignRows(
  before: DecodedImage,
  after: DecodedImage,
  limit = ALIGNMENT_LIMIT,
): AlignedRows | undefined {
  if (before.width !== after.width) return undefined;

  const width = after.width;
  const was = wordsOf(before);
  const now = wordsOf(after);
  const whole = pairWords(was, now, before.height, after.height, width, limit);
  const kept = explains(whole) ? whole.rows : undefined;
  const left = kept === undefined ? whole.positional : whole.paired;
  const strips = left > 0 ? stripped(was, now, before.height, after.height, width, limit, kept, left) : undefined;
  if (strips !== undefined) return { ...spansOf(strips), strips };
  return kept && { inserted: kept.inserted, removed: kept.removed, shifted: kept.shifted, strips: [{ ...kept, from: 0, to: width }] };
}

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
interface Weighed {
  readonly rows: PairedRows;
  readonly paired: number;
  readonly positional: number;
}

function pairWords(
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
  const rows = straddled(pairing(left, right, script, afterHeight, cost), was, now, beforeHeight, width, cost);

  let paired = 0;
  for (let y = head; y < afterHeight; y += 1) {
    const from = rows.source[y]!;
    paired += from < 0 ? width : differing(was, from, now, y, width);
  }
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
 * shifted no row and only says where rows came or went, else position.
 */
function explains({ rows, paired, positional }: Weighed): boolean {
  return paired < positional || (paired === positional && rows.shifted.length === 0);
}

/**
 * The page in vertical strips, each paired on its own, when that leaves fewer
 * than `whole` pixels differing.
 *
 * A column that differs anywhere by position over the height both images have
 * is one that moved; the rest stayed. A still stretch narrower than
 * {@link STRIP_WIDTH} between moved ones, or at an edge beside one, is a
 * gutter of the moved content rather than a column, and joins it. Each strip is
 * paired, or compared by position on the after image's canvas, whichever leaves
 * fewer pixels differing there, with an unmatched row charged in full either
 * way since the strips are judged on that canvas. A tie with the whole-width
 * pairing keeps the whole width: one strip says less and moves the same.
 */
function stripped(
  was: Uint32Array,
  now: Uint32Array,
  beforeHeight: number,
  afterHeight: number,
  width: number,
  limit: number,
  kept: PairedRows | undefined,
  whole: number,
): AlignedStrip[] | undefined {
  const differs = differingColumns(was, now, Math.min(beforeHeight, afterHeight), width);
  const bounds = stripsOf(differs, width);
  if (bounds.length < 2) return undefined;
  // A still strip is equal by position over the height both have, so nothing
  // leaves less differing there than position: its rows past the shorter foot.
  // When every still strip is one row repeated down both images, a margin,
  // two rows are equal across the width exactly when they are equal in the
  // strip that moved, so with one moved strip the whole-width pairing is
  // already its pairing: what it leaves there is what it leaves anywhere, less
  // what it leaves in the margins. Every other moved strip is paired on its own.
  const floor = (columns: number): number => Math.abs(afterHeight - beforeHeight) * columns;
  let reused: { rows: PairedRows; paired: number } | undefined;
  const still = bounds.filter((strip) => !strip.moved);
  if (
    kept !== undefined &&
    still.length === bounds.length - 1 &&
    still.every(({ from, to }) => uniform(was, beforeHeight, width, from, to, now, afterHeight))
  ) {
    let rest = whole;
    for (const { from, to } of still) rest -= costIn(kept, was, now, width, from, to);
    reused = { rows: kept, paired: rest };
  }

  const strips: AlignedStrip[] = [];
  let total = 0;
  for (const { from, to, moved } of bounds) {
    const columns = to - from;
    let placed = floor(columns);
    let rows: PairedRows | undefined;
    let paired = Infinity;
    if (moved) {
      for (let x = from; x < to; x += 1) placed += differs[x]!;
      if (reused !== undefined) ({ rows, paired } = reused);
      else {
        const left = columnsOf(was, beforeHeight, width, from, to);
        const right = columnsOf(now, afterHeight, width, from, to);
        ({ rows, paired } = pairWords(left, right, beforeHeight, afterHeight, columns, limit));
      }
    }
    const pairs = rows !== undefined && (paired < placed || (paired === placed && rows.shifted.length === 0));
    total += pairs ? paired : placed;
    if (total >= whole) return undefined;
    strips.push({ ...(pairs ? rows! : position(beforeHeight, afterHeight)), from, to });
  }
  return strips;
}

/** Whether columns `from` up to `to` hold one row, the same, at every height of both images. */
function uniform(
  was: Uint32Array,
  beforeHeight: number,
  width: number,
  from: number,
  to: number,
  now: Uint32Array,
  afterHeight: number,
): boolean {
  for (let y = 0; y < beforeHeight; y += 1) if (differingIn(was, y, was, 0, width, from, to) > 0) return false;
  for (let y = 0; y < afterHeight; y += 1) if (differingIn(now, y, was, 0, width, from, to) > 0) return false;
  return true;
}

/** What `rows` leaves differing in columns `from` up to `to`, charged as {@link Weighed} charges it. */
function costIn(rows: PairedRows, was: Uint32Array, now: Uint32Array, width: number, from: number, to: number): number {
  let cost = 0;
  for (const [y, source] of rows.source.entries()) {
    cost += source < 0 ? to - from : differingIn(was, source, now, y, width, from, to);
  }
  for (const span of rows.removed) cost += (span.to - span.from) * (to - from);
  return cost;
}

/** The pixels that differ between two rows, in columns `from` up to `to`. */
function differingIn(
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

/** Narrower than this, a still stretch beside moved columns is part of them. */
const STRIP_WIDTH = 16;

/** Per column, how many rows both images have differ there by position: a column that differs in any moved. */
function differingColumns(was: Uint32Array, now: Uint32Array, height: number, width: number): Uint32Array {
  const counts = new Uint32Array(width);
  for (let y = 0; y < height; y += 1) {
    const at = y * width;
    for (let x = 0; x < width; x += 1) if (was[at + x] !== now[at + x]) counts[x]! += 1;
  }
  return counts;
}

function stripsOf(flags: Uint32Array, width: number): (RowSpan & { moved: boolean })[] {
  const runs: { from: number; to: number; moved: boolean }[] = [];
  for (let x = 0; x < width; x += 1) {
    const last = runs.at(-1);
    if (last !== undefined && last.moved === flags[x]! > 0) last.to = x + 1;
    else runs.push({ from: x, to: x + 1, moved: flags[x]! > 0 });
  }
  for (const [index, run] of runs.entries()) {
    const beside = runs[index - 1]?.moved === true || runs[index + 1]?.moved === true;
    if (!run.moved && beside && run.to - run.from < STRIP_WIDTH) run.moved = true;
  }
  const strips: { from: number; to: number; moved: boolean }[] = [];
  for (const run of runs) {
    const last = strips.at(-1);
    if (last !== undefined && last.moved === run.moved) last.to = run.to;
    else strips.push({ ...run });
  }
  return strips;
}

/** The words of columns `from` up to `to`, as an image of their own. */
function columnsOf(words: Uint32Array, height: number, width: number, from: number, to: number): Uint32Array {
  const columns = to - from;
  const out = new Uint32Array(height * columns);
  for (let y = 0; y < height; y += 1) out.set(words.subarray(y * width + from, y * width + to), y * columns);
  return out;
}

/** Every row against the row at its own height, and the rows one image has past the other's foot. */
function position(beforeHeight: number, afterHeight: number): PairedRows {
  const source = new Int32Array(afterHeight).fill(-1);
  for (let y = 0; y < Math.min(beforeHeight, afterHeight); y += 1) source[y] = y;
  return {
    source,
    inserted: afterHeight > beforeHeight ? [{ from: beforeHeight, to: afterHeight }] : [],
    removed: beforeHeight > afterHeight ? [{ from: afterHeight, to: beforeHeight, at: afterHeight }] : [],
    shifted: [],
    grown: [],
    shrunk: [],
  };
}

/** Every strip's spans, each with the columns it covers. */
function spansOf(strips: readonly AlignedStrip[]): RowAlignment {
  const within = <T extends RowSpan>(spans: readonly T[], { from, to }: AlignedStrip): T[] =>
    spans.map((span) => ({ ...span, columns: { from, to } }));
  return {
    inserted: strips.flatMap((strip) => within(strip.inserted, strip)),
    removed: strips.flatMap((strip) => within(strip.removed, strip)),
    shifted: strips.flatMap((strip) => within(strip.shifted, strip)),
  };
}

/** Every channel at 255, whichever way the bytes are read. */
const WHITE = 0xffffffff;

function differing(left: Uint32Array, leftRow: number, right: Uint32Array, rightRow: number, width: number): number {
  return differingIn(left, leftRow, right, rightRow, width, 0, width);
}

function matching(words: Uint32Array, row: number, word: number, width: number): number {
  let count = 0;
  for (let index = row * width, end = index + width; index < end; index += 1) if (words[index] === word) count += 1;
  return count;
}

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
function wordsOf({ width, height, data }: DecodedImage): Uint32Array {
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
 * The script, as rows.
 *
 * A kept run pairs row for row. The rows a run grew by are inserted, as the
 * rows it lost are removed: a button whose padding grew six rows is six new
 * rows where it grew, and paired with copies of its own row it would leave no
 * pixel, no region and nothing for a reviewer to look at. When a kept run is
 * longer on the before side, what is left of it opens the band that follows.
 *
 * A stretch of removed and added runs between two kept ones is a band that was
 * rewritten, and its rows are paired by position within the band, so a sentence
 * whose text changed is compared glyph against glyph rather than reported as
 * new. Position within a band is counted from its top or from its bottom,
 * whichever leaves fewer pixels differing (`cost` counts them for one pair of
 * rows): a block drawn into the middle of a gap leaves the gap's lower rows in
 * the band, and from the top they would sit against the block. What the band
 * cannot pair is either removed, when it is before rows, or inserted and marked
 * in full, when it is after rows.
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
