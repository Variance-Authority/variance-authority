import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import type { Observation } from '@variance-authority/observe';
import type { RasterStore } from '@variance-authority/raster';
import { writeEvidence } from './evidence.js';

/**
 * The diff of a subject that changed size.
 *
 * An insertion makes a page taller, and the diff is the one picture that shows
 * where the new rows went in: the comparison aligns the rows and draws the diff
 * on the after image's canvas, so a resized pair has a diff like any other.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'va-evidence-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('the evidence of a subject that grew', () => {
  it('writes the diff, on the after image’s canvas', async () => {
    const before = raster(3);
    const after = raster(5);
    const store = { find: async () => ({ raster: before }) } as unknown as RasterStore;
    const observation = {
      subject: 'page',
      verdict: 'changed',
      comparison: { dimensionsChanged: true },
    } as unknown as Observation;

    const evidence = await writeEvidence(directory, { subject: 'page' }, observation, after, store);

    expect(evidence?.diff).toBeDefined();
    const diff = PNG.sync.read(await readFile(evidence!.diff!));
    expect([diff.width, diff.height]).toEqual([4, 5]);
  });
});

function raster(height: number): Raster {
  const png = new PNG({ width: 4, height });
  png.data.fill(255);
  return {
    documentDigest: 'v1:same',
    identity: IDENTITY,
    width: 4,
    height,
    bytes: PNG.sync.write(png).toString('base64'),
    missingFonts: [],
  };
}
