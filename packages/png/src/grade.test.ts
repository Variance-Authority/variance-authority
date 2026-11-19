import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { isolateRegions } from '@variance-authority/core/attribute';
import { SEVERITY_LEVELS, STRONG_GRADE } from '@variance-authority/raster';
import { comparePngs } from './compare.js';

/**
 * The site's own page, from a review whose sentence read its faint marks like
 * its real change: 137 rows that gain a 53-row insertion, the call to action's
 * two marks, read against rows the pairing moved by a fraction of a row, and
 * the footer's one, repainted by 7 levels. Both come from one run's images.
 */
const file = (side: string): Buffer => readFileSync(new URL(`./fixtures/site-grade-${side}.png`, import.meta.url));

describe('a region graded by how strongly it differs', () => {
  it('grades the repainted marks faint and the inserted rows strong', () => {
    const comparison = comparePngs(file('before'), file('after'));
    const regions = isolateRegions(comparison.mask).regions;

    expect(regions.map(({ x, y, width, height, grade }) => ({ x, y, width, height, grade }))).toEqual([
      { x: 0, y: 0, width: 1280, height: 53, grade: SEVERITY_LEVELS.length },
      { x: 456, y: 139, width: 3, height: 1, grade: 3 },
      { x: 650, y: 139, width: 3, height: 1, grade: 3 },
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
});
