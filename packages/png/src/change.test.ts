import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { isolateRegions } from '@variance-authority/core/attribute';
import { changeImages } from './change.js';
import { comparePngs } from './compare.js';

/**
 * The change at its own size.
 *
 * A comment that shows two whole pages scales a 1280-pixel page to the column,
 * and the change in it cannot be read. The crop is what is shown instead, so
 * these hold it to the three things a reviewer relies on: it is cut where the
 * change is, it keeps one image pixel per pixel, and its before panel shows the
 * before content beside the change rather than whatever shared its coordinates.
 */

const BLACK = [0, 0, 0, 255];
const GREY = [0x80, 0x80, 0x80, 255];
const RED = [255, 0, 0, 255];

/** A white image with full-width rows painted, by row number. */
function image(width: number, height: number, painted: Record<number, readonly number[]> = {}): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(255);
  for (const [row, colour] of Object.entries(painted)) {
    for (let x = 0; x < width; x += 1) png.data.set(colour, (Number(row) * width + x) * 4);
  }
  return PNG.sync.write(png);
}

function regionsOf(before: Buffer, after: Buffer) {
  return isolateRegions(comparePngs(before, after).mask).regions;
}

/** The colour of each row of a column, top to bottom. */
function column(png: PNG, x: number): string[] {
  return Array.from({ length: png.height }, (_, y) => {
    const at = (y * png.width + x) * 4;
    return [...png.data.subarray(at, at + 4)].join(',');
  });
}

describe('the picture of an insertion', () => {
  // Rows 0..9 of the before image; three black rows go in above row 5.
  const before = image(40, 10, { 2: GREY, 7: GREY });
  const after = image(40, 13, { 2: GREY, 5: BLACK, 6: BLACK, 7: BLACK, 10: GREY });

  it('stacks the before, after and difference panels of one crop', () => {
    const { change } = changeImages(before, after, regionsOf(before, after));
    const sheet = PNG.sync.read(change!);

    // The page is narrower than a crop, so the crop is the page: 10 before rows,
    // 13 after rows, 13 difference rows and two 2-row gaps.
    expect([sheet.width, sheet.height]).toEqual([40, 10 + 2 + 13 + 2 + 13]);
  });

  it('shows the before rows either side of the insertion, not the rows under it', () => {
    const { change } = changeImages(before, after, regionsOf(before, after));
    const rows = column(PNG.sync.read(change!), 0).slice(0, 10);

    // The before image itself, with no black row: nothing was there before.
    expect(rows.filter((colour) => colour === BLACK.join(','))).toEqual([]);
    expect(rows[2]).toBe(GREY.join(','));
    expect(rows[7]).toBe(GREY.join(','));
  });
});

describe('the crop of a long page', () => {
  it('cuts around the change with its context, at the narrowest readable width', () => {
    const before = image(1280, 2000);
    const changed = PNG.sync.read(image(1280, 2000));
    // A 10×10 block at x 600, y 1000.
    for (let y = 1000; y < 1010; y += 1) {
      for (let x = 600; x < 610; x += 1) changed.data.set(BLACK, (y * 1280 + x) * 4);
    }
    const after = PNG.sync.write(changed);

    const sheet = PNG.sync.read(changeImages(before, after, regionsOf(before, after)).change!);

    // 32 rows above and below the 10, three panels, two gaps.
    expect([sheet.width, sheet.height]).toEqual([320, 3 * (32 + 10 + 32) + 2 * 2]);
  });

  it('keeps the top of an inserted section taller than a panel', () => {
    // Every before row its own shade, so the only pairing is the true one.
    const shade = (y: number) => [y, y, y, 255];
    const before = image(40, 100, Object.fromEntries(Array.from({ length: 100 }, (_, y) => [y, shade(y)])));
    const after = image(
      40,
      1100,
      Object.fromEntries(
        Array.from({ length: 1100 }, (_, y) => [y, y < 50 ? shade(y) : y < 1050 ? RED : shade(y - 1000)]),
      ),
    );

    const sheet = PNG.sync.read(changeImages(before, after, regionsOf(before, after)).change!);

    // Each panel stops at 400 rows, from 32 rows above the insertion. The
    // before panel is those 32 rows: everything else in the window is new.
    expect(sheet.height).toBe(32 + 2 + 400 + 2 + 400);
  });
});

describe('the picture of a removal', () => {
  it('shows the removed rows in the before panel', () => {
    const before = image(40, 13, { 5: BLACK, 6: BLACK, 7: BLACK });
    const after = image(40, 10);

    const { change } = changeImages(before, after, regionsOf(before, after));
    const rows = column(PNG.sync.read(change!), 0);

    expect(rows.slice(5, 8)).toEqual([BLACK, BLACK, BLACK].map((colour) => colour.join(',')));
  });
});

describe('the picture of a gap that grew', () => {
  // A white gap between two grey rows got three rows taller: no pixel of the
  // after image is new, so no region marks it, and the rows under it moved.
  it('is cut where the rows start to move', () => {
    const before = image(40, 200, { 10: GREY, 150: GREY });
    const after = image(40, 203, { 10: GREY, 153: GREY });
    const { change } = changeImages(before, after, regionsOf(before, after));

    const sheet = PNG.sync.read(change!);
    const rows = column(sheet, 0);

    // One window of context around the seam, not the page: each panel is far
    // shorter than 200 rows, and the after panel holds the grey row that moved.
    expect(sheet.height).toBeLessThan(200);
    expect(rows).toContain(GREY.join(','));
  });
});

describe('no change to cut', () => {
  it('has a difference and no crop', () => {
    const same = image(40, 10, { 2: GREY });
    const result = changeImages(same, same, []);

    expect(PNG.sync.read(result.diff).height).toBe(10);
    expect(result.change).toBeUndefined();
  });
});
