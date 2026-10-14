import { describe, expect, it } from 'vitest';
import { differencePixels } from './mask.js';
import { comparePixels } from './compare.js';

/**
 * A full-page capture is a column of rows, and content in a document flows: a
 * paragraph inserted near the top pushes everything under it down. Compared
 * position by position, every row below the insertion then sits against the row
 * that used to be there, and the whole tail of the page reads as changed.
 *
 * These pin what a reviewer needs instead: the inserted band is the change, the
 * content below it is matched where it moved to, and anything that really
 * changed in that content is still found.
 */

const WIDTH = 4;

describe('content that moved down the page', () => {
  it('marks the inserted rows and nothing below them', () => {
    const before = column([1, 2, 3, 4, 5]);
    const after = column([1, 9, 9, 2, 3, 4, 5]);

    const difference = differencePixels(before, after, undefined, { diffMask: true });

    expect([difference.width, difference.height]).toEqual([WIDTH, 7]);
    expect(changedRows(difference.data, difference.width)).toEqual([1, 2]);
    expect(difference.changed).toBe(2 * WIDTH);
  });

  it('still finds a pixel that changed in the content that moved', () => {
    const before = column([1, 2, 3, 4, 5]);
    const after = column([1, 9, 2, 3, 4, 5]);
    // One pixel of the last row, which now sits one row lower.
    after.data.set([0, 0, 0, 255], (5 * WIDTH + 2) * 4);

    const difference = differencePixels(before, after, undefined, { diffMask: true });

    expect(changedRows(difference.data, difference.width)).toEqual([1, 5]);
    expect(difference.changed).toBe(WIDTH + 1);
  });

  it('compares a rewritten band row against row, not as an insertion', () => {
    const before = column([1, 2, 3, 4]);
    const after = column([1, 7, 3, 4]);
    // The rewritten row differs from the old one in a single pixel.
    for (let x = 0; x < WIDTH; x += 1) after.data.set(before.data.subarray((WIDTH + x) * 4, (WIDTH + x + 1) * 4), (WIDTH + x) * 4);
    after.data.set([0, 0, 0, 255], (WIDTH + 1) * 4);

    const difference = differencePixels(before, after, undefined, { diffMask: true });

    expect(difference.changed).toBe(1);
  });

  it('marks a block drawn into the middle of a gap, not the gap under it', () => {
    // A gap four rows tall, with a three-row block drawn into it two rows down.
    const before = column([5, 1, 1, 1, 1, 5]);
    const after = column([5, 1, 1, 9, 9, 9, 1, 1, 5]);

    const difference = differencePixels(before, after, undefined, { diffMask: true });

    expect(changedRows(difference.data, difference.width)).toEqual([3, 4, 5]);
    expect(difference.changed).toBe(3 * WIDTH);
  });

  it('carries removed rows on the comparison, since no after pixel shows them', () => {
    const comparison = comparePixels(column([1, 2, 3, 4, 5]), column([1, 4, 5]));

    expect(comparison.changed).toEqual({ default: 0, strict: 0 });
    expect(comparison.dimensionsChanged).toBe(true);
    expect([comparison.width, comparison.height]).toEqual([WIDTH, 3]);
    expect(comparison.alignment).toEqual({
      inserted: [],
      removed: [{ from: 1, to: 3, at: 1 }],
      shifted: [{ from: 1, to: 3, by: -2 }],
    });
  });

  it('names where rows were inserted and how far the content below moved', () => {
    const comparison = comparePixels(column([1, 2, 3]), column([1, 8, 8, 8, 2, 3]));

    expect(comparison.alignment).toEqual({
      inserted: [{ from: 1, to: 4 }],
      removed: [],
      shifted: [{ from: 4, to: 6, by: 3 }],
    });
    expect(comparison.mask.height).toBe(6);
    expect(comparison.total).toBe(WIDTH * 6);
  });

  it('compares position by position when that leaves fewer pixels differing', () => {
    // Two lines of text with a mark beside them, a blank row and an unmarked
    // line. The mark beside the first line went and the blank row filled in:
    // nothing moved. The shortest edit between the row columns still pairs the
    // marked line that stayed with the one above it, which is a shift, and
    // that pairing leaves eight pixels differing where position leaves six.
    const before = lines(['marked', 'marked', 'blank', 'text']);
    const after = lines(['text', 'marked', 'text', 'text']);

    const comparison = comparePixels(before, after);

    expect(comparison.alignment).toBeUndefined();
    expect(comparison.changed.default).toBe(1 + (LINE - 3));
  });

  it('names a row added at the bottom, which position explains as well', () => {
    const comparison = comparePixels(column([1, 2, 3]), column([1, 2, 3, 8]));

    expect(comparison.alignment).toEqual({ inserted: [{ from: 3, to: 4 }], removed: [], shifted: [] });
    expect(comparison.changed.default).toBe(WIDTH);
  });

  it('compares position by position when the widths differ', () => {
    const narrow = column([1, 2, 3]);
    const wide = { width: WIDTH + 1, height: 3, data: new Uint8Array((WIDTH + 1) * 3 * 4).fill(255) };

    const comparison = comparePixels(narrow, wide);

    expect(comparison.alignment).toBeUndefined();
    expect([comparison.width, comparison.height]).toEqual([WIDTH + 1, 3]);
  });
});

/** One image whose rows are solid greys, one per value: equal values are equal rows. */
function column(rows: readonly number[]): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(WIDTH * rows.length * 4);
  for (const [y, value] of rows.entries()) {
    for (let x = 0; x < WIDTH; x += 1) data.set([value * 20, value * 20, value * 20, 255], (y * WIDTH + x) * 4);
  }
  return { width: WIDTH, height: rows.length, data };
}

const LINE = 8;

/**
 * One image of rows a page has: text from the fourth column on, a mark in the
 * first column beside text, or nothing.
 */
function lines(rows: readonly ('blank' | 'marked' | 'text')[]): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(LINE * rows.length * 4).fill(255);
  for (const [y, row] of rows.entries()) {
    if (row === 'blank') continue;
    for (let x = 3; x < LINE; x += 1) data.set([0x33, 0x33, 0x33, 255], (y * LINE + x) * 4);
    if (row === 'marked') data.set([255, 0, 0, 255], y * LINE * 4);
  }
  return { width: LINE, height: rows.length, data };
}

function changedRows(mask: Uint8Array, width: number): number[] {
  const rows = new Set<number>();
  for (let index = 3; index < mask.length; index += 4) {
    if (mask[index] !== 0) rows.add(Math.floor((index - 3) / 4 / width));
  }
  return [...rows].sort((a, b) => a - b);
}
