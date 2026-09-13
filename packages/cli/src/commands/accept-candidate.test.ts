import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { readCandidate } from './accept.js';

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

async function candidate(sidecar: object, png?: Buffer): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'va-candidate-'));
  const stem = join(directory, 'subject.after');
  await writeFile(`${stem}.json`, JSON.stringify(sidecar));
  if (png !== undefined) await writeFile(`${stem}.png`, png);
  return stem;
}

/**
 * What the report may name as a candidate, and what comes back.
 *
 * Two addresses for one thing: a PNG whose sidecar sits beside it, and a sidecar
 * that is the whole candidate. The second is the pixel-less tier — a subject the
 * run observed through its document and never photographed — and a reader that
 * insisted on the image would refuse the only evidence there is.
 */
describe('reading a candidate the report named', () => {
  it('pairs the image with the sidecar beside it', async () => {
    const stem = await candidate(
      { identity: IDENTITY, documentDigest: 'sha256-a', width: 4, height: 2, missingFonts: [] },
      Buffer.from('png'),
    );

    const raster: Raster = await readCandidate(`${stem}.png`);

    expect(raster.bytes).toBe(Buffer.from('png').toString('base64'));
    expect(raster.width).toBe(4);
  });

  it('reads a sidecar alone, and does not invent pixels for it', async () => {
    const stem = await candidate({
      identity: IDENTITY,
      documentDigest: 'sha256-a',
      missingFonts: [],
    });

    const raster: Raster = await readCandidate(`${stem}.json`);

    expect(raster.documentDigest).toBe('sha256-a');
    expect(raster.bytes).toBeUndefined();
    expect(raster.width).toBeUndefined();
  });

  it('refuses a sidecar that cannot partition or settle anything', async () => {
    const stem = await candidate({ width: 4, height: 2, missingFonts: [] });

    await expect(readCandidate(`${stem}.json`)).rejects.toThrow('is not a raster sidecar');
  });
});
