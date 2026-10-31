import { describe, expect, it } from 'vitest';
import { differencePixels } from './mask.js';
import { comparePixels } from './compare.js';
import { alignRows } from './align.js';

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

  it('marks the rows a gap grew by as inserted, and pairs a rewritten line with the line', () => {
    // The gap under the first line grew by a row, and the line under it changed
    // in one pixel. The row the gap grew by is new, as a row the gap lost would
    // be removed, so a subject whose padding grew has a region to show.
    const before = column([1, 12, 6, 3]);
    const after = column([1, 12, 12, 6, 3]);
    after.data.set([0, 0, 0, 255], (3 * WIDTH + 2) * 4);

    const comparison = comparePixels(before, after);

    expect(comparison.alignment).toEqual({
      inserted: [{ from: 2, to: 3 }],
      removed: [],
      shifted: [{ from: 3, to: 5, by: 1 }],
    });
    expect(comparison.changed.strict).toBe(WIDTH + 1);
  });

  it('says which inserted rows only repeat the run they grew, and which removed rows a run lost', () => {
    // The gap under the first line grew by two rows, and the gap under the
    // second lost one; a new line went in under the third. The grown and lost
    // rows hold nothing their neighbours do not, so they moved what follows
    // without adding or taking content, and the new line did add some.
    const before = column([1, 12, 6, 12, 12, 3, 4]);
    const after = column([1, 12, 12, 12, 6, 12, 3, 9, 4]);

    const rows = alignRows(before, after)!;

    expect(rows.inserted).toEqual([
      { from: 2, to: 4 },
      { from: 7, to: 8 },
    ]);
    expect(rows.grown).toEqual([{ from: 2, to: 4 }]);
    expect(rows.removed).toEqual([{ from: 4, to: 5, at: 6 }]);
    expect(rows.shrunk).toEqual([{ from: 4, to: 5, at: 6 }]);
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

  it('compares position by position rather than remove a row to save a pixel', () => {
    // The second line went and the third took its place, changed in one pixel.
    // Pairing the third with its old row saves that pixel, but only by removing
    // the second line and marking the changed row as new.
    const before = column([1, 12, 6, 3]);
    const after = column([1, 6, 6, 3]);
    after.data.set([0, 0, 0, 255], (2 * WIDTH + 2) * 4);

    const comparison = comparePixels(before, after);

    expect(comparison.alignment).toBeUndefined();
    expect(comparison.changed.strict).toBe(WIDTH + 1);
  });

  it('compares a one-pixel rule that starts a row earlier by position', () => {
    // A thin vertical rule beside nothing grew upward by one row. Removing the
    // white row above it and growing the rule's run pairs every pixel away, but
    // only by moving the rule.
    const rule = (rows: readonly ('blank' | 'ruled')[]) => {
      const image = column([1, ...rows.map(() => 0), 1]);
      for (const [y, row] of rows.entries()) {
        image.data.fill(255, (y + 1) * WIDTH * 4, (y + 2) * WIDTH * 4);
        if (row === 'ruled') image.data.set([0, 0, 0, 255], ((y + 1) * WIDTH + 2) * 4);
      }
      return image;
    };

    const comparison = comparePixels(rule(['blank', 'ruled', 'ruled']), rule(['ruled', 'ruled', 'ruled']));

    expect(comparison.alignment).toBeUndefined();
    expect(comparison.changed.strict).toBe(1);
  });

  it('names a row added at the bottom, which position explains as well', () => {
    const comparison = comparePixels(column([1, 2, 3]), column([1, 2, 3, 8]));

    expect(comparison.alignment).toEqual({ inserted: [{ from: 3, to: 4 }], removed: [], shifted: [] });
    expect(comparison.changed.default).toBe(WIDTH);
  });

  it('pairs the rows under an edit longer than one search allows', () => {
    // A section of 1,100 distinct rows rewritten as 1,150, then 200 rows that
    // only moved down, then a line that changed in place, so the rows that moved
    // are not the shared tail. The shortest edit is 2,252 runs, past one Myers
    // search; the rows that occur once on each side still pair the 200 with
    // their shifted partners, and the rewritten section alone is the change.
    const before = distinct([...range(0, 3), ...range(10, 1110), ...range(5000, 5200), 7000, ...range(9000, 9003)]);
    const after = distinct([...range(0, 3), ...range(2000, 3150), ...range(5000, 5200), 7001, ...range(9000, 9003)]);

    const comparison = comparePixels(before, after);

    expect(comparison.alignment).toEqual({
      inserted: [{ from: 3 + 1100, to: 3 + 1150 }],
      removed: [],
      shifted: [{ from: 3 + 1150, to: 3 + 1150 + 200 + 1 + 3, by: 50 }],
    });
    expect(comparison.changed.strict).toBe((1150 + 1) * WIDTH);
  });

  it('compares a page whose stretches nest as deep as it is long', () => {
    // Each pass finds one run that occurs once on each side, and the stretch
    // after it still holds an edit past one search, for 12,000 passes:
    // 2,1,3,2,4,3,… against 1,2,3,…, over 3,000 rows that differ throughout.
    // Followed to the bottom, this outgrew the call stack; the work bound stops
    // the split a few dozen passes in and compares the rest by position.
    const depth = 12_000;
    const before = distinct([...range(1, depth + 1).flatMap((k) => [k + 1, k]), ...range(0, 3000).map((i) => 30_000 + (i % 2))]);
    const after = distinct([...range(1, depth + 1), ...range(0, 3000).map((i) => 40_000 + (i % 2))]);

    const comparison = comparePixels(before, after);

    expect(comparison.alignment).toBeDefined();
    expect([comparison.width, comparison.height]).toEqual([WIDTH, depth + 3000]);
  });

  it('pairs rows whose only difference is the colour under a fully transparent pixel', () => {
    // A kept WebP drops that colour (libwebp without `exact`), and no
    // comparison sees it, so a fresh capture that still carries it is the same row.
    const before = column([1, 2, 3, 4, 5]);
    const after = column([1, 9, 2, 3, 4, 5]);
    for (let y = 0; y < before.height; y += 1) before.data.set([0, 0, 0, 0], y * WIDTH * 4);
    for (let y = 0; y < after.height; y += 1) after.data.set([7, 7, 7, 0], y * WIDTH * 4);

    const difference = differencePixels(before, after, undefined, { diffMask: true });

    expect(changedRows(difference.data, difference.width)).toEqual([1]);
    expect(difference.changed).toBe(WIDTH);
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

/** One image whose rows each have a colour of their own: equal values are equal rows, up to 65,536 of them. */
function distinct(rows: readonly number[]): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(WIDTH * rows.length * 4);
  for (const [y, value] of rows.entries()) {
    for (let x = 0; x < WIDTH; x += 1) data.set([value & 0xff, value >>> 8, 0x80, 255], (y * WIDTH + x) * 4);
  }
  return { width: WIDTH, height: rows.length, data };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, index) => from + index);
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
