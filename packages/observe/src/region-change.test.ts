import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { observeRasters } from './observe.js';

/**
 * Whether the verdict's sentence says a region's drawing changed or only its
 * colour, so a reader knows which marks to open before opening any.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium-existing-page',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

type Colour = readonly [number, number, number];
interface Block {
  readonly left: number;
  readonly top: number;
  readonly size: number;
  readonly colour: Colour;
}

/** A white 60×30 page with solid blocks drawn on it. */
function raster(documentDigest: string, blocks: readonly Block[]): Raster {
  const png = new PNG({ width: 60, height: 30 });
  png.data.fill(255);
  for (const { left, top, size, colour } of blocks) {
    for (let y = top; y < top + size; y += 1) {
      for (let x = left; x < left + size; x += 1) {
        const index = (y * 60 + x) * 4;
        png.data[index] = colour[0];
        png.data[index + 1] = colour[1];
        png.data[index + 2] = colour[2];
      }
    }
  }
  return {
    documentDigest,
    identity: IDENTITY,
    width: 60,
    height: 30,
    bytes: PNG.sync.write(png).toString('base64'),
    missingFonts: [],
  };
}

const GREY: Colour = [0x33, 0x33, 0x33];
const RED: Colour = [0xcc, 0x00, 0x33];

describe('what changed in each region', () => {
  it('says only the colour changed where a block was recoloured in place', async () => {
    const result = await observeRasters(
      'button',
      raster('v1:before', [{ left: 10, top: 10, size: 10, colour: GREY }]),
      raster('v1:after', [{ left: 10, top: 10, size: 10, colour: RED }]),
    );

    expect(result.verdict).toBe('changed');
    expect(result.isolation!.regions.map((region) => region.change)).toEqual(['colour']);
    expect(result.because).toBe('100 pixels differ across 1 region, only its colour changed');
  });

  it('says the shape changed where a block moved', async () => {
    const result = await observeRasters(
      'button',
      raster('v1:before', [{ left: 10, top: 10, size: 10, colour: GREY }]),
      raster('v1:after', [{ left: 13, top: 10, size: 10, colour: GREY }]),
    );

    expect(result.because).toBe('60 pixels differ across 1 region, its shape changed');
  });

  it('counts the regions apart when one moved and one was recoloured', async () => {
    const result = await observeRasters(
      'button',
      raster('v1:before', [
        { left: 4, top: 10, size: 10, colour: GREY },
        { left: 40, top: 10, size: 10, colour: GREY },
      ]),
      raster('v1:after', [
        { left: 4, top: 10, size: 10, colour: RED },
        { left: 43, top: 10, size: 10, colour: GREY },
      ]),
    );

    expect(result.because).toBe('160 pixels differ across 2 regions, 1 changed in shape and 1 only in colour');
  });

  it('says which regions it read when the cap left some out', async () => {
    const result = await observeRasters(
      'button',
      raster('v1:before', [
        { left: 4, top: 10, size: 10, colour: GREY },
        { left: 40, top: 10, size: 8, colour: GREY },
      ]),
      raster('v1:after', [
        { left: 4, top: 10, size: 10, colour: RED },
        { left: 40, top: 10, size: 8, colour: RED },
      ]),
      { limit: 1 },
    );

    expect(result.because).toMatch(/not listed, 64px\), each listed changed only in colour$/);
  });
});
