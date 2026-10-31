import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { documentDigest, type Raster, type RenderDocument, type RenderIdentity } from '@variance-authority/core/format';
import { pngjsDecoder, type PngDecoder } from '@variance-authority/png';
import type { Renderer } from '@variance-authority/raster';
import { createDurableStore } from '@variance-authority/store/durable';
import { keptRaster } from '@variance-authority/store/keep';
import { observeAgainstBaseline } from './observe.js';

/**
 * A document that moved and painted the same pixels is settled at the pixel
 * tier, and that tier reads the digest the accept kept rather than decoding
 * the baseline: the capture is decoded once, the baseline never.
 */

const MACHINE: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

/** A box of one shade on a pale ground: flat colour, as a component paints. */
function painted(shade: number): string {
  const image = new PNG({ width: 16, height: 12 });
  for (let at = 0; at < image.data.length; at += 4) {
    const x = (at / 4) % 16;
    const y = Math.floor(at / 4 / 16);
    image.data.set(x >= 4 && x < 12 && y >= 3 && y < 9 ? [shade, 40, 40, 255] : [240, 240, 240, 255], at);
  }
  return PNG.sync.write(image).toString('base64');
}

function documentOf(html: string): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id: 's', kind: 'fixture' },
    html,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: { width: 16, height: 12, deviceScaleFactor: 1, colorScheme: 'light' },
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

function rendererOf(bytes: string): Renderer {
  return {
    identity: MACHINE,
    identityFor: () => MACHINE,
    async render(document: RenderDocument): Promise<Raster> {
      return { documentDigest: documentDigest(document), identity: MACHINE, width: 16, height: 12, bytes, missingFonts: [] };
    },
    async close(): Promise<void> {},
  };
}

function counting(): PngDecoder & { calls: number } {
  const decoder = {
    calls: 0,
    decode: async (bytes: Uint8Array) => {
      decoder.calls += 1;
      return pngjsDecoder.decode(bytes);
    },
  };
  return decoder;
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-pixel-digest-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('a moved document against a kept baseline', () => {
  it('settles the same pixels without decoding the baseline', async () => {
    const store = createDurableStore(root);
    const same = rendererOf(painted(10));
    await store.put({ subject: 's' }, await keptRaster(await same.render(documentOf('<i>before</i>'))));
    const decoder = counting();

    const observation = await observeAgainstBaseline(documentOf('<i>after</i>'), { subject: 's' }, { renderer: same, store, decoder });

    expect(observation.verdict).toBe('unchanged');
    expect(decoder.calls).toBe(1);
  });

  it('decodes the baseline when the pixels moved', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 's' }, await keptRaster(await rendererOf(painted(10)).render(documentOf('<i>before</i>'))));
    const decoder = counting();

    const observation = await observeAgainstBaseline(
      documentOf('<i>after</i>'),
      { subject: 's' },
      { renderer: rendererOf(painted(200)), store, decoder },
    );

    expect(observation.verdict).toBe('changed');
    expect(decoder.calls).toBe(2);
  });
});

describe('a change whose edges stayed put', () => {
  it('is named a change of colour only', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 's' }, await keptRaster(await rendererOf(painted(10)).render(documentOf('<i>before</i>'))));

    const observation = await observeAgainstBaseline(
      documentOf('<i>after</i>'),
      { subject: 's' },
      { renderer: rendererOf(painted(200)), store },
    );

    expect(observation.because).toContain('colour only');
  });

  it('is not, when something changed shape', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 's' }, await keptRaster(await rendererOf(painted(10)).render(documentOf('<i>before</i>'))));
    const notched = PNG.sync.read(Buffer.from(painted(10), 'base64'));
    notched.data.set([255, 255, 255, 255], (5 * 16 + 7) * 4);

    const observation = await observeAgainstBaseline(
      documentOf('<i>after</i>'),
      { subject: 's' },
      { renderer: rendererOf(PNG.sync.write(notched).toString('base64')), store },
    );

    expect(observation.verdict).toBe('changed');
    expect(observation.because).not.toContain('colour only');
  });
});
