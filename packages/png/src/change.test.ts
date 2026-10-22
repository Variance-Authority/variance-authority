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
 * reads as unchanged; and what changed is marked on both sides, over the
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

/**
 * The sheet, cut into its parts: the two panels' columns, inside the margin,
 * and the rows from the first window's top. Each window is found by its frame,
 * down the column just left of the before panel.
 */
function sheetOf(change: Buffer | undefined) {
  const png = PNG.sync.read(change!);
  // The margin, the gutter and the frame follow the crop's width, which is the panel's.
  const across = (panel: number) => 2 * changeLayout(panel).unit + 2 * panel + changeLayout(panel).gutter;
  let panel = 1;
  while (across(panel) < png.width) panel += 1;
  const layout = changeLayout(panel);
  const { unit, gutter, frame } = layout;
  const pixel = (x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)].join(',');
  const framed: { top: number; bottom: number }[] = [];
  for (let y = 0; y < png.height; y += 1) {
    if (pixel(unit - frame, y) !== CHANGE_COLOURS.frame.join(',')) continue;
    const last = framed.at(-1);
    if (last !== undefined && last.bottom === y) last.bottom = y + 1;
    else framed.push({ top: y, bottom: y + 1 });
  }
  const first = framed[0]!.top + frame;
  return {
    png,
    panel,
    layout,
    /** Rows from the top of the sheet to the first window's. */
    header: first,
    /** Each window's rows, from the first window's top. */
    windows: framed.map(({ top, bottom }) => ({ top: top + frame - first, bottom: bottom - frame - first })),
    /** A pixel of the before panel, at a row from the first window's top. */
    before: (x: number, y: number) => pixel(unit + x, first + y),
    /** A pixel of the after panel. */
    after: (x: number, y: number) => pixel(unit + panel + gutter + x, first + y),
    /** A pixel of the gutter between them. */
    gutter: (x: number, y: number) => pixel(unit + panel + x, first + y),
    /** A pixel of the sheet, from its top left corner. */
    pixel,
    /** Rows from the first window's top to the last one's bottom. */
    rows: framed.at(-1)!.bottom - frame - first,
  };
}

const colour = (rgba: readonly number[]) => rgba.join(',');

/** `pixel` under the wash a mark lays over what changed. */
const washed = (pixel: readonly number[], side: 'before' | 'after') =>
  colour([...[0, 1, 2].map((channel) => Math.round(pixel[channel]! * 0.7 + CHANGE_COLOURS[side][channel]! * 0.3)), 255]);

/** Every pixel of one panel, as colour strings. */
function panelPixels(sheet: ReturnType<typeof sheetOf>, side: 'before' | 'after'): string[] {
  const out: string[] = [];
  for (let y = 0; y < sheet.rows; y += 1) for (let x = 0; x < sheet.panel; x += 1) out.push(sheet[side](x, y));
  return out;
}

/** The rows of the sheet's windows from window `from` on, without the canvas between them. */
function rowsOf(sheet: ReturnType<typeof sheetOf>, from = 0): number[] {
  return sheet.windows.slice(from).flatMap(({ top, bottom }) => Array.from({ length: bottom - top }, (_, at) => top + at));
}

describe('the picture of an insertion', () => {
  // Twenty before rows; three black rows go in above row 7, so the grey row
  // under them moves from 12 to 15.
  const before = image(40, 20, { 1: GREY, 12: GREY });
  const after = image(40, 23, { 1: GREY, 7: BLACK, 8: BLACK, 9: BLACK, 15: GREY });
  const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);

  it('lays before and after side by side, framed on a canvas, under a label each', () => {
    // The page is narrower than a crop, so each panel is the page: 23 rows, the
    // after image's, with the before rows set level with the ones they became.
    const { unit, gutter, header } = sheet.layout;
    expect(sheet.panel).toBe(40);
    expect([sheet.png.width, sheet.rows, sheet.header]).toEqual([2 * unit + 2 * 40 + gutter, 23, header]);
    // The canvas around the panels and between them.
    expect([sheet.pixel(0, header), sheet.gutter(1, 0), sheet.pixel(sheet.png.width - 1, header)]).toEqual(
      Array(3).fill(colour(CHANGE_COLOURS.canvas)),
    );
    // Each label's mark over its own column.
    const marks = (from: number) =>
      Array.from({ length: header * sheet.panel }, (_, at) => sheet.pixel(from + (at % sheet.panel), Math.floor(at / sheet.panel)));
    expect(marks(unit)).toContain(colour(CHANGE_COLOURS.before));
    expect(marks(unit + sheet.panel + gutter)).toContain(colour(CHANGE_COLOURS.after));
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

  it('marks the inserted rows on the after panel, washed and edged in its colour', () => {
    expect(panelPixels(sheet, 'after')).toContain(colour(CHANGE_COLOURS.after));
    expect(sheet.after(20, 8)).toBe(washed(BLACK, 'after'));
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
    expect(sheet.before(160, 37)).toBe(washed(GREY, 'before'));
    expect(sheet.after(160, 37)).toBe(washed(BLACK, 'after'));
    // The edge runs just outside the block, and the page beyond it is the page.
    const { frame } = sheet.layout;
    expect(sheet.before(155 - frame, 37)).toBe(colour(CHANGE_COLOURS.before));
    expect(sheet.after(165 + frame - 1, 37)).toBe(colour(CHANGE_COLOURS.after));
    expect(sheet.after(155 - frame - 1, 37)).toBe(colour(WHITE));
  });

  it('can be told from the page on a dark page and on a light one', () => {
    for (const page of [BLACK, WHITE]) {
      const before = image(400, 200, {}, page);
      const after = block(before, 200, 100, 8, GREY);

      const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);

      // The edge beside the block, in a colour that stands off the page.
      const middle = sheet.rows >> 1;
      const row = Array.from({ length: sheet.panel }, (_, x) => sheet.after(x, middle));
      expect(row).toContain(colour(CHANGE_COLOURS.after));
      expect(contrast(CHANGE_COLOURS.after, page)).toBeGreaterThanOrEqual(3);
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
    expect([10, 11, 12].map((y) => sheet.before(20, y))).toEqual(Array(3).fill(washed(BLACK, 'before')));
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
    const below = rowsOf(sheet, 1);
    // A line across the gutter, not a chevron's two points or the bar's centre.
    const across = (y: number) => gutter(y).slice(2, -2).every((pixel) => pixel === colour(CHANGE_COLOURS.moved));

    // The block's window, 32 rows of context either side of its 8, then the gap's.
    expect(sheet.windows.map(({ top, bottom }) => bottom - top)).toEqual([72, expect.any(Number)]);
    expect(below.some((y) => gutter(y).includes(colour(CHANGE_COLOURS.moved)))).toBe(true);
    // Both edges of the rows the gap grew by: two lines, `stroke` rows thick each.
    expect(below.filter(across)).toHaveLength(2 * sheet.layout.stroke);
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
    const below = rowsOf(sheet, 1);
    const across = (y: number) => {
      // A line across the gutter, not a chevron's two points or the bar's centre.
      const span = Array.from({ length: sheet.layout.gutter - 4 }, (_, x) => sheet.gutter(x + 2, y));
      return span.every((pixel) => pixel === colour(CHANGE_COLOURS.moved));
    };
    const filler = CHANGE_COLOURS.filler.map(colour);
    const either = (y: number) =>
      Array.from({ length: sheet.panel }, (_, x) => [sheet.before(x, y), sheet.after(x, y)]).flat();

    expect(sheet.windows.map(({ top, bottom }) => bottom - top)).toEqual([72, expect.any(Number)]);
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

    expect(sheet.after(20, 15)).toBe(washed(BLACK, 'after'));
    expect(gutter(15)).not.toContain(colour(CHANGE_COLOURS.moved));
  });
});

/** `source`, with "text" painted over `rows` from column `left` to `right`: a dark stroke every other column, in a shade of its own each row. */
function text(source: Buffer, rows: readonly number[], left: number, right: number): Buffer {
  const png = PNG.sync.read(source);
  for (const y of rows) for (let x = left; x < right; x += 1) if ((x + y) % 2 === 0) png.data.set([y % 64, 0, 0, 255], (y * png.width + x) * 4);
  return PNG.sync.write(png);
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, at) => from + at);

describe('a sheet of several cuts', () => {
  // A small change near the top and a wide one far below: two windows.
  const before = block(image(1280, 1000), 600, 40, 8, GREY);
  const wide = PNG.sync.read(before);
  for (let x = 100; x < 900; x += 1) wide.data.set(BLACK, (604 * 1280 + x) * 4);
  const after = block(PNG.sync.write(wide), 600, 40, 8, BLACK);
  const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);
  const { unit, frame } = sheet.layout;

  it('cuts every window as wide as the widest, framed at the same columns', () => {
    expect(sheet.windows).toHaveLength(2);
    expect(sheet.panel).toBeGreaterThanOrEqual(800);
    for (const { top } of sheet.windows) {
      expect(sheet.pixel(unit + sheet.panel + frame - 1, sheet.header + top)).toBe(colour(CHANGE_COLOURS.frame));
      expect(sheet.pixel(unit + sheet.panel + frame, sheet.header + top)).toBe(colour(CHANGE_COLOURS.canvas));
    }
  });

  it('sets the windows apart by a margin of canvas', () => {
    const [first, second] = sheet.windows;
    const between = range(first!.bottom + frame, second!.top - frame);
    expect(between.length).toBe(unit - 2 * frame);
    for (const y of between) {
      expect(new Set(range(0, sheet.png.width).map((x) => sheet.pixel(x, sheet.header + y)))).toEqual(
        new Set([colour(CHANGE_COLOURS.canvas)]),
      );
    }
  });
});

describe('the labels over the columns', () => {
  const before = block(image(400, 200), 200, 100, 8, GREY);
  const after = block(image(400, 200), 200, 100, 8, BLACK);
  const labels = { subject: 'Button / primary', before: 'baseline', after: 'this run' };

  it('set the subject over both columns, and where each side came from', () => {
    const plain = sheetOf(changeImages(before, after, regionsOf(before, after)).change);
    const titled = sheetOf(changeImages(before, after, regionsOf(before, after), undefined, labels).change);
    expect(titled.header).toBe(changeLayout(titled.panel, true).header);
    expect(titled.header).toBeGreaterThan(plain.header);
    // Dark type where the title goes, and in the before label past "Before".
    const dark = (x: number, y: number) => titled.pixel(x, y).split(',').map(Number)[0]! < 0x80;
    const { unit, title } = titled.layout;
    expect(range(unit, unit + titled.panel).some((x) => range(unit, unit + title).some((y) => dark(x, y)))).toBe(true);
    const label = range(titled.header - unit * 2, titled.header);
    const [plainRight, titledRight] = [plain, titled].map((sheet) =>
      Math.max(...range(unit, unit + sheet.panel).filter((x) => label.some((y) => sheet.pixel(x, sheet.header - titled.header + y).split(',').map(Number)[0]! < 0x80))),
    );
    expect(titledRight).toBeGreaterThan(plainRight!);
  });
});

describe('where a mark runs', () => {
  it('moves its edges out to the space either side of the word it starts in', () => {
    // A word from column 50 to 90; the change is a few columns in its middle.
    const before = text(image(200, 120), range(50, 60), 50, 90);
    const filled = PNG.sync.read(before);
    for (let y = 50; y < 60; y += 1) for (let x = 70; x < 75; x += 1) filled.data.set([y % 64, 0, 0, 255], (y * 200 + x) * 4);
    const after = PNG.sync.write(filled);
    const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);

    const edged = rowsOf(sheet).filter((y) => sheet.after(50 - sheet.layout.frame, y) === colour(CHANGE_COLOURS.after));
    expect(edged.length).toBeGreaterThan(0);
    expect(edged.every((y) => sheet.after(90, y) === colour(CHANGE_COLOURS.after))).toBe(true);
  });

  it('runs along no row a removed blank one left behind', () => {
    // Text, a blank row, more text; the blank row is taken out, and a block
    // further down changes.
    const lines = (source: Buffer, gap: number) =>
      text(text(source, range(40, 45), 0, 200), range(45 + gap, 50 + gap), 0, 200);
    const before = block(lines(image(200, 101), 1), 100, 71, 8, GREY);
    const after = block(lines(image(200, 100), 0), 100, 70, 8, BLACK);
    const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);

    // Only the block is marked: nothing reaches the left of the page.
    expect(rowsOf(sheet).map((y) => sheet.before(5, y))).not.toContain(colour(CHANGE_COLOURS.before));
    expect(panelPixels(sheet, 'before')).toContain(colour(CHANGE_COLOURS.before));
  });
});

describe('the ends of a cut', () => {
  it('move out of a line of text to the rows above it, and a margin more', () => {
    // A line of text 30 rows tall, its foot 30 rows above a change: the context would cut it.
    const page = text(image(200, 200), range(40, 70), 20, 180);
    const before = block(page, 100, 100, 6, GREY);
    const after = block(page, 100, 100, 6, BLACK);
    const sheet = sheetOf(changeImages(before, after, regionsOf(before, after)).change);

    const blank = (y: number) => range(0, sheet.panel).every((x) => sheet.before(x, y) === colour(WHITE));
    const first = rowsOf(sheet).findIndex((y) => !blank(y));
    // The whole line, under blank rows: its first row is the page's row 40.
    expect(first).toBeGreaterThan(0);
    expect(sheet.windows[0]!.bottom - first).toBe(200 - 40 - (200 - (100 + 6 + 32)));
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
