import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { isolateRegions } from '@variance-authority/core/attribute';
import { CHANGE_COLOURS, changeImages, changeLayout } from './change.js';
import { comparePngs } from './compare.js';

/**
 * The change at its own size, before beside after.
 *
 * A comment that shows two whole pages scales a 1280-pixel page to the column,
 * and the change in it cannot be read. The crop is what is shown instead, so
 * these hold it to what a reviewer relies on: it is cut where the change is, at
 * one image pixel per pixel; before and after sit side by side with the rows
 * that show the same content level with each other, so content that only moved
 * reads as unchanged; and what changed is outlined on both sides, over the
 * pages' own pixels rather than in a separate panel of red.
 */

const BLACK = [0, 0, 0, 255];
const GREY = [0x80, 0x80, 0x80, 255];
const RED = [255, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
/** A row of its own: no two shades are alike, so a row pairs only with its copy. */
const shade = (y: number) => [y % 256, Math.floor(y / 256), 100, 255];

/** A white image with full-width rows painted, by row number. */
function image(width: number, height: number, painted: Record<number, readonly number[]> = {}, base = WHITE): Buffer {
  const png = new PNG({ width, height });
  for (let index = 0; index < width * height * 4; index += 4) png.data.set(base, index);
  for (const [row, colour] of Object.entries(painted)) {
    for (let x = 0; x < width; x += 1) png.data.set(colour, (Number(row) * width + x) * 4);
  }
  return PNG.sync.write(png);
}

/** `image`, with a block painted. */
function block(source: Buffer, left: number, top: number, size: number, colour: readonly number[]): Buffer {
  const png = PNG.sync.read(source);
  for (let y = top; y < top + size; y += 1) {
    for (let x = left; x < left + size; x += 1) png.data.set(colour, (y * png.width + x) * 4);
  }
  return PNG.sync.write(png);
}

function regionsOf(before: Buffer, after: Buffer) {
  return isolateRegions(comparePngs(before, after).mask).regions;
}

/** The sheet, cut into its parts: the two panels' columns and the rows under the header. */
function sheetOf(change: Buffer | undefined) {
  const png = PNG.sync.read(change!);
  // The gutter and stroke follow the crop's width, which is the panel's.
  let panel = 1;
  while (panel * 2 + changeLayout(panel).gutter < png.width) panel += 1;
  const layout = changeLayout(panel);
  const pixel = (x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)].join(',');
  return {
    png,
    panel,
    layout,
    /** A pixel of the before panel, at a row under the header. */
    before: (x: number, y: number) => pixel(x, layout.header + y),
    /** A pixel of the after panel, at a row under the header. */
    after: (x: number, y: number) => pixel(panel + layout.gutter + x, layout.header + y),
    /** A pixel of the gutter between them. */
    gutter: (x: number, y: number) => pixel(panel + x, layout.header + y),
    /** Rows under the header. */
    rows: png.height - layout.header,
  };
}

const colour = (rgba: readonly number[]) => rgba.join(',');

/** Every pixel of one panel, as colour strings. */
function panelPixels(sheet: ReturnType<typeof sheetOf>, side: 'before' | 'after'): string[] {
  const out: string[] = [];
  for (let y = 0; y < sheet.rows; y += 1) for (let x = 0; x < sheet.panel; x += 1) out.push(sheet[side](x, y));
  return out;
}

describe('the picture of an insertion', () => {
  // Twenty before rows; three black rows go in above row 7, so the grey row
  // under them moves from 12 to 15.
  const before = image(40, 20, { 1: GREY, 12: GREY });
  const after = image(40, 23, { 1: GREY, 7: BLACK, 8: BLACK, 9: BLACK, 15: GREY });
  const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);

  it('lays before and after side by side, under a header, with no difference panel', () => {
    // The page is narrower than a crop, so each panel is the page: 23 rows, the
    // after image's, with the before rows set level with the ones they became.
    expect(sheet.panel).toBe(40);
    expect([sheet.png.width, sheet.rows]).toEqual([2 * 40 + sheet.layout.gutter, 23]);
    expect(sheet.before(0, -sheet.layout.header)).toBe(colour(CHANGE_COLOURS.before));
    expect(sheet.after(0, -sheet.layout.header)).toBe(colour(CHANGE_COLOURS.after));
  });

  it('sets the content under the insertion level with where it moved to', () => {
    // Before row 12 is after row 15, so the grey line sits on one row of the sheet.
    expect(sheet.before(20, 1)).toBe(colour(GREY));
    expect(sheet.after(20, 1)).toBe(colour(GREY));
    expect(sheet.before(20, 15)).toBe(colour(GREY));
    expect(sheet.after(20, 15)).toBe(colour(GREY));
  });

  it('shows nothing of the before page opposite the inserted rows, and no black row', () => {
    expect(panelPixels(sheet, 'before')).not.toContain(colour(BLACK));
    expect(CHANGE_COLOURS.filler.map(colour)).toContain(sheet.before(20, 8));
  });

  it('outlines the inserted rows on the after panel, and leaves their pixels alone', () => {
    expect(panelPixels(sheet, 'after')).toContain(colour(CHANGE_COLOURS.after));
    expect(sheet.after(20, 8)).toBe(colour(BLACK));
    // Nothing on the before side was there to outline.
    expect(panelPixels(sheet, 'before')).not.toContain(colour(CHANGE_COLOURS.before));
  });

  it('marks the rows under the insertion as moved, in the gutter beside them', () => {
    const gutter = (y: number) => Array.from({ length: sheet.layout.gutter }, (_, x) => sheet.gutter(x, y));
    expect(gutter(18)).toContain(colour(CHANGE_COLOURS.moved));
    expect(gutter(1)).not.toContain(colour(CHANGE_COLOURS.moved));
  });
});

describe('a change in place', () => {
  it('outlines the same place on both panels', () => {
    const before = image(1280, 2000);
    // A 10×10 block at x 600, y 1000, grey before and black after.
    const was = block(before, 600, 1000, 10, GREY);
    const now = block(before, 600, 1000, 10, BLACK);

    const sheet = sheetOf(changeImages(was, now, regionsOf(was, now)).change);

    // 32 rows above and below the 10, at the narrowest readable width.
    expect(sheet.panel).toBe(320);
    expect(sheet.rows).toBe(32 + 10 + 32);
    // The crop is centred on the block, which starts at column 600 - 445 = 155 of it, row 32.
    expect(sheet.before(160, 37)).toBe(colour(GREY));
    expect(sheet.after(160, 37)).toBe(colour(BLACK));
    const ring = (side: 'before' | 'after') =>
      Array.from({ length: 12 }, (_, x) => sheet[side](155 - 12 + x, 37)).filter((pixel) => pixel !== colour(WHITE));
    expect(ring('before')).toContain(colour(CHANGE_COLOURS.before));
    expect(ring('after')).toContain(colour(CHANGE_COLOURS.after));
  });

  it('can be told from the page on a dark page and on a light one', () => {
    for (const page of [BLACK, WHITE]) {
      const before = image(400, 200, {}, page);
      const after = block(before, 200, 100, 8, GREY);

      const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);

      // Out from the block's left edge to the page: the outline, and nothing of the block.
      const middle = sheet.rows >> 1;
      const edge = Array.from({ length: sheet.panel }, (_, x) => sheet.after(x, middle)).indexOf(colour(GREY));
      const outline = Array.from({ length: 16 }, (_, at) => sheet.after(edge - 1 - at, middle)).filter(
        (pixel) => pixel !== colour(page),
      );
      expect(outline).toContain(colour(CHANGE_COLOURS.after));
      const best = Math.max(...outline.map((pixel) => contrast(pixel.split(',').map(Number), page)));
      expect(best).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the crop of a long insertion', () => {
  it('keeps the top of an inserted section taller than a panel', () => {
    // Every before row its own shade, so the only pairing is the true one.
    const before = image(40, 100, Object.fromEntries(Array.from({ length: 100 }, (_, y) => [y, shade(y)])));
    const after = image(
      40,
      1100,
      Object.fromEntries(
        Array.from({ length: 1100 }, (_, y) => [y, y < 50 ? shade(y) : y < 1050 ? RED : shade(y - 1000)]),
      ),
    );

    const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);

    // The sheet stops at 400 rows, from 32 rows above the insertion.
    expect(sheet.rows).toBe(400);
    expect(sheet.before(20, 0)).toBe(colour(shade(18)));
  });
});

describe('the picture of a removal', () => {
  it('shows the removed rows on the before panel, outlined, opposite nothing', () => {
    // Every row its own shade, and three black rows taken out at row 10.
    const after = image(40, 30, Object.fromEntries(Array.from({ length: 30 }, (_, y) => [y, shade(y)])));
    const before = image(
      40,
      33,
      Object.fromEntries(Array.from({ length: 33 }, (_, y) => [y, y < 10 ? shade(y) : y < 13 ? BLACK : shade(y - 3)])),
    );

    const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);

    // The after rows and the removed ones: 33 rows, the removed three level with nothing.
    expect(sheet.rows).toBe(33);
    expect([10, 11, 12].map((y) => sheet.before(20, y))).toEqual([BLACK, BLACK, BLACK].map(colour));
    expect(CHANGE_COLOURS.filler.map(colour)).toContain(sheet.after(20, 11));
    expect(sheet.before(20, 20)).toBe(colour(shade(17)));
    expect(sheet.after(20, 20)).toBe(colour(shade(17)));
    expect(panelPixels(sheet, 'before')).toContain(colour(CHANGE_COLOURS.before));
  });
});

describe('content that only moved', () => {
  // A white gap above rows of their own shades got three rows taller: the three
  // rows are inserted, and the rows under them moved.
  it('is cut where the gap grew, and outlined nowhere', () => {
    const before = image(40, 100, Object.fromEntries(Array.from({ length: 50 }, (_, y) => [50 + y, shade(y)])));
    const after = image(40, 103, Object.fromEntries(Array.from({ length: 50 }, (_, y) => [53 + y, shade(y)])));
    const regions = regionsOf(before, after);
    const sheet = sheetOf(changeImages(before, after, regions).change);

    expect(regions.length).toBeGreaterThan(0);
    // One window of context around the rows the gap grew by, not the page.
    expect(sheet.rows).toBeLessThan(100);
    expect(panelPixels(sheet, 'after')).not.toContain(colour(CHANGE_COLOURS.after));
    expect(panelPixels(sheet, 'before')).not.toContain(colour(CHANGE_COLOURS.before));
  });

  const shaded = (top: number) => Object.fromEntries(Array.from({ length: 300 }, (_, y) => [top + y, shade(y)]));

  it('cuts a gap that grew after the change, marked in the gutter and outlined nowhere', () => {
    // A block changes near the top; far below, the gap above the shaded rows grows by three rows.
    const before = block(image(40, 1000, shaded(700)), 10, 50, 8, GREY);
    const after = block(image(40, 1003, shaded(703)), 10, 50, 8, BLACK);

    const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);
    const gutter = (y: number) => Array.from({ length: sheet.layout.gutter }, (_, x) => sheet.gutter(x, y));
    // Under the block's window: the gap's, without the rows of its own header.
    const header = (y: number) =>
      sheet.before(0, y) === colour(CHANGE_COLOURS.before) && sheet.after(0, y) === colour(CHANGE_COLOURS.after);
    const below = Array.from({ length: sheet.rows - 72 }, (_, at) => 72 + at).filter((y) => !header(y));

    // The block's window, 32 rows of context either side of its 8, then the gap's.
    expect(sheet.rows).toBeGreaterThan(72);
    expect(below.some((y) => gutter(y).includes(colour(CHANGE_COLOURS.moved)))).toBe(true);
    const outlined = below.some((y) =>
      Array.from({ length: sheet.panel }, (_, x) => sheet.after(x, y)).includes(colour(CHANGE_COLOURS.after)),
    );
    expect(outlined).toBe(false);
  });

  it('cuts a gap that shrank after the change, one line across the gutter and no filler', () => {
    // A block changes near the top; far below, the gap above the shaded rows loses three rows.
    const before = block(image(40, 1003, shaded(703)), 10, 50, 8, GREY);
    const after = block(image(40, 1000, shaded(700)), 10, 50, 8, BLACK);

    const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);
    const header = (y: number) =>
      sheet.before(0, y) === colour(CHANGE_COLOURS.before) && sheet.after(0, y) === colour(CHANGE_COLOURS.after);
    const below = Array.from({ length: sheet.rows - 72 }, (_, at) => 72 + at).filter((y) => !header(y));
    const across = (y: number) => {
      // A line across the gutter, not a chevron's two points or the bar's centre.
      const span = Array.from({ length: sheet.layout.gutter - 4 }, (_, x) => sheet.gutter(x + 2, y));
      return span.every((pixel) => pixel === colour(CHANGE_COLOURS.moved));
    };
    const filler = CHANGE_COLOURS.filler.map(colour);
    const either = (y: number) =>
      Array.from({ length: sheet.panel }, (_, x) => [sheet.before(x, y), sheet.after(x, y)]).flat();

    expect(sheet.rows).toBeGreaterThan(72);
    // The rows the gap lost are spacing, not content only one side has.
    expect(below.some((y) => either(y).some((pixel) => filler.includes(pixel)))).toBe(false);
    expect(below.some((y) => either(y).includes(colour(CHANGE_COLOURS.before)))).toBe(false);
    // One edge, where the gap closed: a single line, `stroke` rows thick.
    expect(below.filter(across)).toHaveLength(sheet.layout.stroke);
  });

  it('gives no window to a gap one row taller beside a change: that is rounding', () => {
    const before = block(image(40, 1000, shaded(700)), 10, 50, 8, GREY);
    const after = block(image(40, 1001, shaded(701)), 10, 50, 8, BLACK);

    const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);

    // One window around the block: 32 rows of context either side of its 8.
    expect(sheet.rows).toBe(32 + 8 + 32);
  });

  it('marks nothing as moved beside a change that also moved', () => {
    // Three rows inserted at 7, and the grey line under them, which moved from
    // 12 to 15, also turned black.
    const before = image(40, 20, { 1: GREY, 12: GREY });
    const after = image(40, 23, { 1: GREY, 7: BLACK, 8: BLACK, 9: BLACK, 15: BLACK });
    const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);
    const gutter = (y: number) => Array.from({ length: sheet.layout.gutter }, (_, x) => sheet.gutter(x, y));

    expect(sheet.after(20, 15)).toBe(colour(BLACK));
    expect(gutter(15)).not.toContain(colour(CHANGE_COLOURS.moved));
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

/** WCAG contrast ratio between two colours. */
function contrast(left: readonly number[], right: readonly number[]): number {
  const luminance = ([r, g, b]: readonly number[]) => {
    const linear = (value: number) => {
      const unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r!) + 0.7152 * linear(g!) + 0.0722 * linear(b!);
  };
  const [light, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}
