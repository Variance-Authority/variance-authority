import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { digestFileName, identityDigest } from '@variance-authority/core/format';
import { createDurableStore } from './durable.js';
import { BLUE, GREEN, RED, kept } from './image.fixture.js';

/**
 * What an identity partition is called on disk, and the name it used to be called.
 *
 * Baselines no longer live in a partition, and the render cache still does,
 * as `v1-<hex>`. The layout before `baselines.path` wrote baselines into
 * partitions spelled `v1-<hex>`, and before that into the raw `v1:<hex>`
 * digest; a repository can hold either. Both are made here by hand, as such a
 * repository has them.
 */

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

const RUNNER: RenderIdentity = { ...MAC, platform: 'linux/x64' };

function rasterOf(identity: RenderIdentity, digest = 'v1:doc', bytes = RED): Raster {
  return { documentDigest: digest, identity, width: 10, height: 10, bytes, missingFonts: [] };
}

/** A pair as an earlier store left it, under the raw digest unless told otherwise. */
async function oldPair(holder: string, leaf: string, raster: Raster, spelling: 'raw' | 'written' = 'raw'): Promise<void> {
  const digest = identityDigest(raster.identity);
  const directory = join(holder, spelling === 'raw' ? digest : digestFileName(digest));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${leaf}.png`), Buffer.from(raster.bytes!, 'base64'));
  await writeFile(join(directory, `${leaf}.json`), JSON.stringify({ ...raster, bytes: undefined }));
}

/** Every path under a directory, relative to it. */
async function tree(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-partition-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the partition a store writes', () => {
  it('is the render cache`s alone, spelled without a colon', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'button' }, rasterOf(MAC));
    await store.renderCache.put(rasterOf(MAC, 'v1:0123456789abcdef0123456789abcdef'));

    const hex = identityDigest(MAC).slice('v1:'.length);
    expect(await tree(root)).toEqual([
      'button-chromium.json',
      'button-chromium.webp',
      `v1-${hex}/by-document/v1-0123456789abcdef0123456789abcdef.json`,
      `v1-${hex}/by-document/v1-0123456789abcdef0123456789abcdef.png`,
    ]);
  });
});

describe('a partition named with the raw digest', () => {
  it('still compares, in both lookup tiers', async () => {
    await oldPair(root, 'button', rasterOf(MAC, 'v1:doc', RED));
    const store = createDurableStore(root);

    const found = await store.find({ subject: 'button' }, MAC);
    expect(found?.comparable).toBe(true);
    expect(found?.raster.bytes).toBe(RED);
    expect(found?.relocated).toEqual({ from: `${identityDigest(MAC)}/button`, to: 'button-chromium' });
    expect((await store.describe({ subject: 'button' }, MAC))?.comparable).toBe(true);
  });

  it('is another machine`s baseline when another machine wrote it', async () => {
    await oldPair(root, 'button', rasterOf(RUNNER));
    const store = createDurableStore(root);

    const found = await store.find({ subject: 'button' }, MAC);
    expect(found?.comparable).toBe(false);
    expect(found?.storedUnder).toEqual(RUNNER);
    expect((await store.describe({ subject: 'button' }, MAC))?.comparable).toBe(false);
  });

  it('is read ahead of another machine`s partition, so a comparable baseline wins', async () => {
    await oldPair(root, 'button', rasterOf(MAC, 'v1:doc', BLUE));
    await oldPair(root, 'button', rasterOf(RUNNER, 'v1:doc', GREEN), 'written');
    const store = createDurableStore(root);

    const found = await store.find({ subject: 'button' }, MAC);
    expect(found?.comparable).toBe(true);
    expect(found?.raster.bytes).toBe(BLUE);
  });

  it('is found under the id`s own directories, and a component directory is never mistaken for one', async () => {
    await oldPair(join(root, 'ui', 'Button'), 'primary', rasterOf(RUNNER));
    await mkdir(join(root, 'ui', 'Button', 'Icon'), { recursive: true });
    const store = createDurableStore(root);

    const found = await store.find({ subject: 'ui/Button/primary' }, MAC);
    expect(found?.comparable).toBe(false);
    expect(found?.storedUnder).toEqual(RUNNER);
  });

  it('is moved by the next `put`, leaving one copy at the template path', async () => {
    await oldPair(root, 'button', rasterOf(MAC, 'v1:doc', RED));
    const store = createDurableStore(root);

    await store.put({ subject: 'button' }, rasterOf(MAC, 'v1:doc', GREEN));

    expect(await tree(root)).toEqual(['button-chromium.json', 'button-chromium.webp']);
    expect((await store.find({ subject: 'button' }, MAC))?.raster.bytes).toBe(await kept(GREEN));
  });

  it('keeps the subjects a `put` did not name', async () => {
    await oldPair(root, 'button', rasterOf(MAC));
    await oldPair(root, 'card', rasterOf(MAC));
    const store = createDurableStore(root);

    await store.put({ subject: 'button' }, rasterOf(MAC, 'v1:doc', GREEN));

    expect(await readdir(join(root, identityDigest(MAC)))).toEqual(['card.json', 'card.png']);
    expect((await store.find({ subject: 'card' }, MAC))?.comparable).toBe(true);
  });

  it('holds planned subjects the plan names, and names the ones it does not', async () => {
    await oldPair(root, 'home.html', rasterOf(MAC));
    await oldPair(root, 'blog.html', rasterOf(MAC));
    const store = createDurableStore(root);

    expect(await store.unplanned?.([{ subject: 'home.html' }], MAC)).toEqual(['blog.html']);
  });
});
