import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { decodePortable, imageFormat, KEEP_LIMIT } from '@variance-authority/png';
import { createDurableStore } from './durable.js';
import { keptRaster } from './keep.js';

/**
 * A baseline is kept as a lossless WebP: the bytes a store holds are only
 * storage, so they shrink once, where a difference is accepted, and decode to
 * the picture that was accepted. The store writes only bytes already kept, and
 * reads only bytes that are what their record says. A baseline kept before
 * that stays a PNG on disk and reads as one until it is accepted again.
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
  return PNG.sync.write(image);
}

function rasterOf(bytes: Buffer, width = 6, height = 4): Raster {
  return { documentDigest: 'v1:doc', identity: CHROMIUM, width, height, bytes: bytes.toString('base64'), missingFonts: [] };
}

async function keptOf(bytes: Buffer, width = 6, height = 4): Promise<Raster> {
  return keptRaster(rasterOf(bytes, width, height));
}

/** The record a store writes beside an image, for a test that lays one down by hand. */
function recordOf(bytes: Buffer, image?: string): string {
  return JSON.stringify({ ...rasterOf(bytes), bytes: undefined, placedFor: KEY, ...(image === undefined ? {} : { image }) });
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-kept-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('an accepted baseline', () => {
  it('is kept as a WebP that decodes to the accepted capture', async () => {
    const store = createDurableStore(root);
    const accepted = capture(6, 4);
    await store.put(KEY, await keptOf(accepted));

    expect(await readdir(root)).toEqual(['s-chromium.json', 's-chromium.webp']);
    const kept = await readFile(join(root, 's-chromium.webp'));
    expect(imageFormat(kept)).toBe('webp');
    expect(Buffer.from((await decodePortable(kept)).data).equals(PNG.sync.read(accepted).data)).toBe(true);
  });

  it('is found as the kept bytes, which every decoder here reads', async () => {
    const store = createDurableStore(root);
    const kept = await keptOf(capture(6, 4));
    await store.put(KEY, kept);
    expect((await store.find(KEY, CHROMIUM))?.raster.bytes).toBe(kept.bytes);
    expect(await store.describe(KEY, CHROMIUM)).toMatchObject({ pictured: true });
  });

  it('replaces a baseline kept as a PNG, leaving one image beside the record', async () => {
    const store = createDurableStore(root);
    const old = capture(6, 4);
    await writeFile(join(root, 's-chromium.png'), old);
    await writeFile(join(root, 's-chromium.json'), recordOf(old));

    await store.put(KEY, await keptOf(capture(6, 4)));
    expect(await readdir(root)).toEqual(['s-chromium.json', 's-chromium.webp']);
  });

  it('is refused when it is larger than a WebP holds, before anything is encoded', async () => {
    const tall = PNG.sync.write(new PNG({ width: 1, height: KEEP_LIMIT + 1 }));
    await expect(keptOf(tall, 1, KEEP_LIMIT + 1)).rejects.toThrow(/16383/);
  });
});

describe('a store handed bytes nobody kept', () => {
  it('refuses a PNG, naming the seam that keeps one, and writes nothing', async () => {
    const store = createDurableStore(root);
    await expect(store.put(KEY, rasterOf(capture(6, 4)))).rejects.toThrow(/a PNG.*keptRaster/s);
    expect(await readdir(root)).toEqual([]);
  });

  it('refuses a lossy WebP, whose pixels are not the ones accepted', async () => {
    const store = createDurableStore(root);
    const lossy = await sharp(capture(6, 4)).webp({ quality: 50 }).toBuffer();
    await expect(store.put(KEY, rasterOf(lossy))).rejects.toThrow(/a lossy WebP/);
    expect(await readdir(root)).toEqual([]);
  });
});

describe('a kept baseline read back', () => {
  it('is refused when its record names a format no store keeps', async () => {
    await writeFile(join(root, 's-chromium.webp'), Buffer.from((await keptOf(capture(6, 4))).bytes!, 'base64'));
    await writeFile(join(root, 's-chromium.json'), recordOf(capture(6, 4), 'avif'));
    await expect(createDurableStore(root).find(KEY, CHROMIUM)).rejects.toThrow(/avif/);
  });

  it('is refused when its .webp holds a PNG', async () => {
    await writeFile(join(root, 's-chromium.webp'), capture(6, 4));
    await writeFile(join(root, 's-chromium.json'), recordOf(capture(6, 4), 'webp'));
    await expect(createDurableStore(root).find(KEY, CHROMIUM)).rejects.toThrow(/holds a PNG/);
  });

  it('is refused when its .webp holds a lossy WebP', async () => {
    await writeFile(join(root, 's-chromium.webp'), await sharp(capture(6, 4)).webp({ quality: 50 }).toBuffer());
    await writeFile(join(root, 's-chromium.json'), recordOf(capture(6, 4), 'webp'));
    await expect(createDurableStore(root).find(KEY, CHROMIUM)).rejects.toThrow(/holds a lossy WebP/);
  });
});

describe('a baseline kept as a PNG', () => {
  it('is found as the PNG it is, until it is accepted again', async () => {
    const old = capture(6, 4);
    await writeFile(join(root, 's-chromium.png'), old);
    await writeFile(join(root, 's-chromium.json'), recordOf(old));
    const store = createDurableStore(root);
    expect((await store.find(KEY, CHROMIUM))?.raster.bytes).toBe(old.toString('base64'));
    expect(await store.describe(KEY, CHROMIUM)).toMatchObject({ pictured: true });
  });

  it('beside a WebP of the same baseline is damage, not a choice between them', async () => {
    const store = createDurableStore(root);
    await store.put(KEY, await keptOf(capture(6, 4)));
    await writeFile(join(root, 's-chromium.png'), capture(6, 4));
    await expect(store.find(KEY, CHROMIUM)).rejects.toThrow(/s-chromium\.png/);
  });
});

describe('a baseline with no pixels', () => {
  it('beside a WebP it does not claim is damage, since nobody recorded that image', async () => {
    const { width: _w, height: _h, bytes: _b, ...pixelless } = rasterOf(capture(6, 4));
    await writeFile(join(root, 's-chromium.json'), JSON.stringify({ ...pixelless, placedFor: KEY }));
    await writeFile(join(root, 's-chromium.webp'), Buffer.from((await keptOf(capture(6, 4))).bytes!, 'base64'));
    await expect(createDurableStore(root).find(KEY, CHROMIUM)).rejects.toThrow(/s-chromium\.webp/);
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
