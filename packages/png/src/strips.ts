/**
 * The page in vertical strips: content beside a still column, such as a
 * sidebar, paired on its own rather than with the full width of every row.
 */

import type { RowAlignment, RowSpan } from '@variance-authority/raster';
import type { AlignedStrip, PairedRows } from './align.js';
import { differingIn, pairWords } from './rows.js';

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
export function stripped(
  was: Uint32Array,
  now: Uint32Array,
  beforeHeight: number,
  afterHeight: number,
  width: number,
  limit: number,
  kept: PairedRows | undefined,
  whole: number,
): AlignedStrip[] | undefined {
  const shorter = Math.min(beforeHeight, afterHeight);
  const flags = movedColumns(was, now, shorter, width);
  if (flags === undefined) return undefined;
  const bounds = stripsOf(flags, width);
  if (bounds.length < 2) return undefined;
  // A still strip leaves only its rows past the shorter foot. When the still
  // strips are margins, one moved strip's pairing is the whole width's.
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
      if (reused !== undefined) ({ rows, paired } = reused);
      else {
        const left = columnsOf(was, beforeHeight, width, from, to);
        const right = columnsOf(now, afterHeight, width, from, to);
        ({ rows, paired } = pairWords(left, right, beforeHeight, afterHeight, columns, limit));
      }
      placed += placedIn(was, now, shorter, width, from, to, paired - placed);
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

/** Narrower than this, a still stretch beside moved columns is part of them. */
const STRIP_WIDTH = 16;

/**
 * Per column, whether any row both images have differs there by position: a
 * column that does moved. `undefined` once no still stretch as wide as
 * {@link STRIP_WIDTH} is left, since then every column joins one strip; a page
 * that moved across its width is told from its first rows. A row reads only
 * the columns still left.
 */
function movedColumns(was: Uint32Array, now: Uint32Array, height: number, width: number): Uint8Array | undefined {
  const moved = new Uint8Array(width);
  const still = Int32Array.from({ length: width }, (_, x) => x);
  let left = width;
  let narrowed = false;
  for (let y = 0; y < height; y += 1) {
    const at = y * width;
    let kept = 0;
    for (let index = 0; index < left; index += 1) {
      const x = still[index]!;
      if (was[at + x] !== now[at + x]) moved[x] = 1;
      else still[kept++] = x;
    }
    narrowed ||= kept < left;
    left = kept;
    if (narrowed && (y % CHECKED === 0 || y === height - 1)) {
      if (!stillStretch(moved)) return undefined;
      narrowed = false;
    }
  }
  return moved;
}

/** How many rows apart the probe looks for a still stretch that is left. */
const CHECKED = 32;

function stillStretch(moved: Uint8Array): boolean {
  let run = 0;
  for (const flag of moved) {
    run = flag === 0 ? run + 1 : 0;
    if (run >= STRIP_WIDTH) return true;
  }
  return false;
}

/** What position leaves differing in columns `from` up to `to`, counted until it passes `cap`. */
function placedIn(
  was: Uint32Array,
  now: Uint32Array,
  height: number,
  width: number,
  from: number,
  to: number,
  cap: number,
): number {
  let count = 0;
  for (let y = 0; y < height && count <= cap; y += 1) count += differingIn(was, y, now, y, width, from, to);
  return count;
}

function stripsOf(flags: Uint8Array, width: number): (RowSpan & { moved: boolean })[] {
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
export function spansOf(strips: readonly AlignedStrip[]): RowAlignment {
  const within = <T extends RowSpan>(spans: readonly T[], { from, to }: AlignedStrip): T[] =>
    spans.map((span) => ({ ...span, columns: { from, to } }));
  return {
    inserted: strips.flatMap((strip) => within(strip.inserted, strip)),
    removed: strips.flatMap((strip) => within(strip.removed, strip)),
    shifted: strips.flatMap((strip) => within(strip.shifted, strip)),
  };
}
