import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { decodePortable, imageFormat, KEEP_LIMIT } from '@variance-authority/png';
import { createDurableStore } from './durable.js';

/**
 * A baseline is kept as a lossless WebP: the bytes a store holds are only
 * storage, so they shrink once, when a difference is accepted, and decode to
 * every channel of the capture that was accepted. A baseline kept before that
 * stays a PNG on disk and reads as one until it is accepted again.
 */

const CHROMIUM: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const KEY = { subject: 's' };

function capture(width: number, height: number): Buffer {
  const image = new PNG({ width, height });
  for (let at = 0; at < image.data.length; at += 4) image.data.set([at % 251, at % 241, at % 239, 255], at);
  // Colour under a transparent pixel: part of the picture the comparison reads.
  image.data.set([10, 20, 30, 0], 0);
  return PNG.sync.write(image);
}

function rasterOf(bytes: Buffer, width = 6, height = 4): Raster {
  return { documentDigest: 'v1:doc', identity: CHROMIUM, width, height, bytes: bytes.toString('base64'), missingFonts: [] };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-kept-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('an accepted baseline', () => {
  it('is kept as a WebP that decodes to every channel of the accepted capture', async () => {
    const store = createDurableStore(root);
    const accepted = capture(6, 4);
    await store.put(KEY, rasterOf(accepted));

    expect(await readdir(root)).toEqual(['s-chromium.json', 's-chromium.webp']);
    const kept = await readFile(join(root, 's-chromium.webp'));
    expect(imageFormat(kept)).toBe('webp');
    expect(Buffer.from((await decodePortable(kept)).data).equals(PNG.sync.read(accepted).data)).toBe(true);
  });

  it('is found as the kept bytes, which every decoder here reads', async () => {
    const store = createDurableStore(root);
    await store.put(KEY, rasterOf(capture(6, 4)));
    const found = await store.find(KEY, CHROMIUM);
    expect(imageFormat(Buffer.from(found?.raster.bytes ?? '', 'base64'))).toBe('webp');
    expect(await store.describe(KEY, CHROMIUM)).toMatchObject({ pictured: true });
  });

  it('replaces a baseline kept as a PNG, leaving one image beside the record', async () => {
    const store = createDurableStore(root);
    const old = capture(6, 4);
    await writeFile(join(root, 's-chromium.png'), old);
    await writeFile(join(root, 's-chromium.json'), JSON.stringify({ ...rasterOf(old), bytes: undefined, placedFor: KEY }));

    await store.put(KEY, rasterOf(capture(6, 4)));
    expect(await readdir(root)).toEqual(['s-chromium.json', 's-chromium.webp']);
  });

  it('is refused when it is larger than a WebP holds, and the tree is left as it was', async () => {
    const store = createDurableStore(root);
    const tall = PNG.sync.write(new PNG({ width: 1, height: KEEP_LIMIT + 1 }));
    await expect(store.put(KEY, rasterOf(tall, 1, KEEP_LIMIT + 1))).rejects.toThrow(/16383/);
    expect(await readdir(root)).toEqual([]);
  });
});

describe('a baseline kept as a PNG', () => {
  it('is found as the PNG it is, until it is accepted again', async () => {
    const old = capture(6, 4);
    await writeFile(join(root, 's-chromium.png'), old);
    await writeFile(join(root, 's-chromium.json'), JSON.stringify({ ...rasterOf(old), bytes: undefined, placedFor: KEY }));
    const store = createDurableStore(root);
    expect((await store.find(KEY, CHROMIUM))?.raster.bytes).toBe(old.toString('base64'));
    expect(await store.describe(KEY, CHROMIUM)).toMatchObject({ pictured: true });
  });

  it('beside a WebP of the same baseline is damage, not a choice between them', async () => {
    const store = createDurableStore(root);
    await store.put(KEY, rasterOf(capture(6, 4)));
    await writeFile(join(root, 's-chromium.png'), capture(6, 4));
    await expect(store.find(KEY, CHROMIUM)).rejects.toThrow(/s-chromium\.png/);
  });
});

describe('the render cache', () => {
  it('keeps the capture as it came: it is read by the next comparison, never reviewed', async () => {
    const store = createDurableStore(root);
    const rendered = capture(6, 4);
    await store.renderCache.put(rasterOf(rendered));
    expect((await store.renderCache.get('v1:doc', CHROMIUM))?.bytes).toBe(rendered.toString('base64'));
  });
});
