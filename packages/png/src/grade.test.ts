import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { isolateRegions } from '@variance-authority/core/attribute';
import { SEVERITY_LEVELS, STRONG_GRADE } from '@variance-authority/raster';
import { comparePngs, diffImage } from './compare.js';
import { FAINT } from './judge.js';

/**
 * The site's own page, from a review whose sentence read its faint marks like
 * its real change: 137 rows that gain a 53-row insertion, and the footer's one
 * mark, repainted by 7 colour levels. The call to action's two marks, read
 * against rows paired a fraction of a row off, are gone now the pairing keeps
 * them in place. Both images come from one run.
 */
const file = (side: string): Buffer => readFileSync(new URL(`./fixtures/site-grade-${side}.png`, import.meta.url));

describe('a region graded by how strongly it differs', () => {
  it('grades the repainted marks faint and the inserted rows strong', () => {
    const comparison = comparePngs(file('before'), file('after'));
    const regions = isolateRegions(comparison.mask).regions;

    expect(regions.map(({ x, y, width, height, grade }) => ({ x, y, width, height, grade }))).toEqual([
      { x: 0, y: 0, width: 1280, height: 53, grade: SEVERITY_LEVELS.length },
      { x: 100, y: 173, width: 1, height: 1, grade: 1 },
    ]);
    expect(regions.filter((region) => region.grade >= STRONG_GRADE)).toHaveLength(1);
  });

  it('grades a pixel by the levels its distance passes, in the same scan', () => {
    // One pixel per row, black against greys of growing distance.
    const levels = [0, 2, 20, 40, 60];
    const image = (grey: (row: number) => number): Buffer => {
      const png = new PNG({ width: 1, height: levels.length });
      for (const row of levels.keys()) png.data.set([grey(row), grey(row), grey(row), 255], row * 4);
      return PNG.sync.write(png);
    };

    const comparison = comparePngs(image(() => 0), image((row) => levels[row]!), { isolateWith: { id: 'strict', threshold: 0, includeAA: true } });

    expect(Array.from(comparison.mask.data)).toEqual([0, 1, 2, 3, 4]);
  });

  it('paints a faint pixel in the diff picture paler than a strong one', async () => {
    const levels = [0, 2, 20, 40, 60];
    const image = (grey: (row: number) => number): Buffer => {
      const png = new PNG({ width: 1, height: levels.length });
      for (const row of levels.keys()) png.data.set([grey(row), grey(row), grey(row), 255], row * 4);
      return PNG.sync.write(png);
    };

    const picture = PNG.sync.read(await diffImage(image(() => 0), image((row) => levels[row]!), { id: 'strict', threshold: 0, includeAA: true }));
    const pixels = levels.map((_, row) => Array.from(picture.data.subarray(row * 4, row * 4 + 4)));

    expect(pixels.slice(1)).toEqual([[...FAINT, 255], [...FAINT, 255], [...FAINT, 255], [255, 0, 0, 255]]);
  });
});
