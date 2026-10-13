import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { observeRasters } from './observe.js';

/**
 * What the default policy forgives, as the verdict and its sentence report it.
 *
 * A pixel the default policy does not count is a pixel the strict policy still
 * does, and a green verdict over such pixels has to say so in its own sentence:
 * "no pixels differ" is a claim about the images, not about a tolerance
 * (ADR-0002, ADR-0026).
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium-existing-page',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

function raster(documentDigest: string, colour: readonly [number, number, number]): Raster {
  const png = new PNG({ width: 10, height: 10 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = colour[0];
    png.data[index + 1] = colour[1];
    png.data[index + 2] = colour[2];
    png.data[index + 3] = 255;
  }
  return {
    documentDigest,
    identity: IDENTITY,
    width: 10,
    height: 10,
    bytes: PNG.sync.write(png).toString('base64'),
    missingFonts: [],
  };
}

describe('what the default policy forgives', () => {
  it('reports a border-token edit as a change', async () => {
    // `--va-line` from #2f3437 to #3a4043: every border on tribunal's review
    // page, reported `unchanged` with "no pixels differ" at `threshold: 0.1`.
    const result = await observeRasters(
      'review',
      raster('v1:before', [0x2f, 0x34, 0x37]),
      raster('v1:after', [0x3a, 0x40, 0x43]),
    );

    expect(result.verdict).toBe('changed');
    expect(result.because).toBe('100 pixels differ across 1 region');
  });

  it('names the tolerance a green verdict was earned under', async () => {
    const result = await observeRasters(
      'review',
      raster('v1:before', [128, 128, 128]),
      raster('v1:before', [129, 127, 127]),
    );

    expect(result.verdict).toBe('unchanged');
    expect(result.because).toBe(
      'no pixels differ beyond the tolerance of the default policy, which forgave 100 pixels ' +
        'as antialiasing or as a colour change of at most 1%',
    );
  });

  it('says no pixels differ only when none do', async () => {
    const result = await observeRasters(
      'review',
      raster('v1:before', [128, 128, 128]),
      raster('v1:before', [128, 128, 128]),
    );

    expect(result).toMatchObject({ verdict: 'unchanged', because: 'no pixels differ' });
  });
});
