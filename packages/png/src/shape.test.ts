import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { isolateRegions } from '@variance-authority/core/attribute';
import type { Raster } from '@variance-authority/core/format';
import { compareRasters, type ComparedPixels } from './compare.js';
import { REGION_MARGIN, regionChange } from './shape.js';

/**
 * Whether a region's drawing changed or only its colour, on images built pixel
 * by pixel, and on the site's own page where a section was inserted.
 */

type Paint = (x: number, y: number) => readonly [number, number, number];

function raster(width: number, height: number, paint: Paint): Raster {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      image.data.set([...paint(x, y), 255], index);
    }
  }
  return { bytes: PNG.sync.write(image).toString('base64'), width, height } as Raster;
}

/** A block on white, `colour` inside columns `left`..`left + 40` and rows 20..40. */
const block =
  (left: number, colour: readonly [number, number, number]): Paint =>
  (x, y) =>
    x >= left && x < left + 40 && y >= 20 && y < 40 ? colour : [255, 255, 255];

async function read(before: Raster, after: Raster) {
  let pixels: ComparedPixels | undefined;
  const comparison = await compareRasters(before, after, { keep: (kept) => (pixels = kept) });
  const regions = isolateRegions(comparison.mask).regions;
  return { pixels: pixels!, regions };
}

describe('what changed in a region', () => {
  it('reads a recoloured block as colour', async () => {
    const { pixels, regions } = await read(raster(120, 60, block(40, [0x33, 0x33, 0x33])), raster(120, 60, block(40, [0xcc, 0x00, 0x33])));
    expect(regions).toHaveLength(1);
    expect(regions.map((region) => regionChange(pixels, region))).toEqual(['colour']);
  });

  it('reads a recolour of an anti-aliased edge as colour', async () => {
    // Each edge column half covered, as a glyph's edge is drawn.
    const soft =
      (colour: readonly [number, number, number]): Paint =>
      (x, y) =>
        y < 20 || y >= 40 || x < 39 || x > 80
          ? [255, 255, 255]
          : x === 39 || x === 80
            ? (colour.map((channel) => Math.round((channel + 255) / 2)) as unknown as readonly [number, number, number])
            : colour;
    const { pixels, regions } = await read(raster(120, 60, soft([0x33, 0x33, 0x33])), raster(120, 60, soft([0x00, 0x33, 0xcc])));
    expect(regions.map((region) => regionChange(pixels, region))).toEqual(regions.map(() => 'colour'));
  });

  it('reads a block moved by one pixel as shape, at both edges', async () => {
    const { pixels, regions } = await read(raster(120, 60, block(40, [0x33, 0x33, 0x33])), raster(120, 60, block(41, [0x33, 0x33, 0x33])));
    expect(regions).toHaveLength(2);
    expect(regions.map((region) => regionChange(pixels, region))).toEqual(['shape', 'shape']);
  });

  it('reads only the pixels in and just around each region', async () => {
    const { pixels, regions } = await read(raster(120, 60, block(40, [0x33, 0x33, 0x33])), raster(120, 60, block(40, [0xcc, 0x00, 0x33])));
    const [box] = regions;
    const near = (x: number, y: number) =>
      x >= box!.x - REGION_MARGIN && x < box!.x + box!.width + REGION_MARGIN && y >= box!.y - REGION_MARGIN && y < box!.y + box!.height + REGION_MARGIN;
    // Every pixel outside reads as a different checkerboard on each side: one read of it would change the answer.
    const poisoned = (image: ComparedPixels['before'], phase: number) => {
      const data = Uint8Array.from(image.data);
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) if (!near(x, y)) data.fill((x + y + phase) % 2 === 0 ? 0 : 255, (y * image.width + x) * 4, (y * image.width + x) * 4 + 3);
      }
      return { ...image, data };
    };
    const outside = { ...pixels, before: poisoned(pixels.before, 0), after: poisoned(pixels.after, 1) };
    expect(regions.map((region) => regionChange(outside, region))).toEqual(['colour']);
  });

  it("reads the section inserted into the site's own page as shape", async () => {
    const file = (side: string): Buffer => readFileSync(new URL(`./fixtures/site-header-${side}.png`, import.meta.url));
    const page = (bytes: Buffer, height: number) => ({ bytes: bytes.toString('base64'), width: 1280, height }) as Raster;
    const { pixels, regions } = await read(page(file('before'), 220), page(file('after'), 273));
    expect(regions.map((region) => regionChange(pixels, region))).toEqual(['shape']);
  });
});
