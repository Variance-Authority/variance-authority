import type { RowAlignment, RowSpan } from '@variance-authority/raster';
import type { DecodedImage } from './mask.js';
import { explains, pairWords, wordsOf } from './rows.js';
import { spansOf, stripped } from './strips.js';

/**
 * Which row of the before image each row of the after image shows: rows are
 * hashed, runs of identical rows become tokens, and Myers' shortest edit pairs
 * them, so an insertion near the top no longer paints the page below it as
 * changed. A row with no partner is reported, never paired with white, and
 * where the whole width leaves pixels differing, columns that moved apart (a
 * still sidebar beside a grown main column) are paired strip by strip. Past
 * `limit` the edit splits at runs each side holds once ({@link edits}).
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
