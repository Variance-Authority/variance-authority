import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { isolateRegions } from '@variance-authority/core/attribute';
import type { Raster } from '@variance-authority/core/format';
import { alignRows } from './align.js';
import { compareRasters } from './compare.js';

/**
 * The site's own page, from a review that marked its unchanged header: the top
 * 120 rows, repainted by one level per channel in place, and 100 rows below
 * them that gain a 53-row insertion. Both crops come from one run's images.
 */
const file = (side: string): Buffer => readFileSync(new URL(`./fixtures/site-header-${side}.png`, import.meta.url));
const before = file('before');
const after = file('after');

describe("a site header repainted by one level beside a real insertion", () => {
  it("pairs the header in place and shifts only what the insertion pushed down", () => {
    const alignment = alignRows(PNG.sync.read(before), PNG.sync.read(after));
    expect(alignment?.shifted).toEqual([
      { from: 202, to: 214, by: 47 },
      { from: 220, to: 273, by: 53 },
    ]);
    expect(alignment?.inserted).toEqual([
      { from: 155, to: 202 },
      { from: 214, to: 220 },
    ]);
  });

  it("marks the insertion, not the rows it pushed down", async () => {
    const raster = (bytes: Buffer, height: number) => ({ bytes: bytes.toString('base64'), width: 1280, height }) as Raster;
    const comparison = await compareRasters(raster(before, 220), raster(after, 273));
    const regions = isolateRegions(comparison.mask).regions;
    expect(regions.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual([{ x: 0, y: 155, width: 1280, height: 65 }]);
  });
});
