import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { SEVERITY_LEVELS } from '@variance-authority/raster';
import { observeRasters } from './observe.js';

/**
 * Content that moved down or up the page.
 *
 * The comparison pairs each row of the after image with the row of the before
 * image it shows, so an insertion is the inserted rows and not everything under
 * them. That pairing must never make a change read as unchanged: content that
 * moved is a change even when every pixel of it matches the row it moved from,
 * and the sentence says where rows went in and how far the rest moved.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

const WIDTH = 4;

describe('content that moved', () => {
  it('is changed when a gap grew in one place and shrank in another, at the same height', async () => {
    // The white gap under row 1 grows by a row, the one under row 3 loses one:
    // rows 2 and 3 moved down a row, and the page is as tall as it was.
    const before = raster([1, 0, 0, 2, 3, 0, 0, 4]);
    const after = raster([1, 0, 0, 0, 2, 3, 0, 4]);

    const result = await observeRasters('page', before, after);

    expect(result.comparison?.dimensionsChanged).toBe(false);
    expect(result.signals.pixels).toBe('changed');
    expect(result.verdict).toBe('changed');
    expect(result.because).toContain('1 pixel row removed');
  });

  it('names the rows inserted and how far the content under them moved', async () => {
    const before = raster([1, 2, 3, 4, 5]);
    const after = raster([1, 9, 9, 9, 2, 3, 4, 5]);

    const result = await observeRasters('page', before, after);

    expect(result.verdict).toBe('changed');
    expect(result.isolation?.regions).toEqual([
      { x: 0, y: 1, width: WIDTH, height: 3, pixels: 3 * WIDTH, density: 1, grade: SEVERITY_LEVELS.length, change: 'shape' },
    ]);
    expect(result.because).toBe(
      `${3 * WIDTH} pixels differ across 1 region, its shape changed; 3 pixel rows inserted in 1 place, ` +
        'moving the content under them by up to 3 rows, ' +
        `and the subject resized from ${WIDTH}×5 to ${WIDTH}×8`,
    );
  });

  it('counts the rows a column gained, not the sum over columns that each gained them', async () => {
    // A sidebar beside a main column: three rows go into the main column, and
    // the sidebar, which stayed, only runs three rows longer at the foot.
    const side = (y: number) => 20 + ((y * 37) % 200);
    const main = (y: number) => 230 - ((y * 23) % 200);
    const before = painted(40, 10, (x, y) => (x < 20 ? side(y) : main(y)));
    const after = painted(40, 13, (x, y) =>
      x < 20 ? side(Math.min(y, 9)) : y < 2 ? main(y) : y < 5 ? 5 + y : main(y - 3),
    );

    const result = await observeRasters('page', before, after);

    expect(result.because).toContain('3 pixel rows inserted in 2 places');
  });
});

/** An image painted one grey per pixel. */
function painted(width: number, height: number, grey: (x: number, y: number) => number): Raster {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = grey(x, y);
      png.data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { ...raster([]), width, height, bytes: PNG.sync.write(png).toString('base64') };
}

/** An image whose rows are solid greys, one per value: equal values are equal rows, `0` is white. */
function raster(rows: readonly number[]): Raster {
  const png = new PNG({ width: WIDTH, height: rows.length });
  for (const [y, value] of rows.entries()) {
    const grey = value === 0 ? 255 : value * 20;
    for (let x = 0; x < WIDTH; x += 1) png.data.set([grey, grey, grey, 255], (y * WIDTH + x) * 4);
  }
  return {
    documentDigest: 'v1:same',
    identity: IDENTITY,
    width: WIDTH,
    height: rows.length,
    bytes: PNG.sync.write(png).toString('base64'),
    missingFonts: [],
  };
}
