import { mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { digestFileName, identityDigest } from '@variance-authority/core/format';
import { createDurableStore } from './durable.js';

/**
 * What an identity partition is called on disk, and the name it used to be called.
 *
 * The store writes `v1-<hex>` and reads the raw `v1:<hex>` digest as a fallback.
 * The old spelling is made here the way a repository has it: a partition written
 * under the new name, then renamed to the raw digest, which is byte-for-byte
 * what an earlier store left behind.
 */

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

const RUNNER: RenderIdentity = { ...MAC, platform: 'linux/x64' };

function rasterOf(identity: RenderIdentity, digest = 'v1:doc', bytes = 'AAAA'): Raster {
  return { documentDigest: digest, identity, width: 10, height: 10, bytes, missingFonts: [] };
}

/** Rename a partition written today to the raw digest an earlier store wrote. */
async function spellWithColon(holder: string, identity: RenderIdentity): Promise<void> {
  const digest = identityDigest(identity);
  await rename(join(holder, digestFileName(digest)), join(holder, digest));
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
  it('spells the identity without a colon, for the baseline and the render cache alike', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'button' }, rasterOf(MAC));
    await store.renderCache.put(rasterOf(MAC, 'v1:0123456789abcdef0123456789abcdef'));

    const hex = identityDigest(MAC).slice('v1:'.length);
    expect(await tree(root)).toEqual([
      `v1-${hex}/button.json`,
      `v1-${hex}/button.png`,
      `v1-${hex}/by-document/v1-0123456789abcdef0123456789abcdef.json`,
      `v1-${hex}/by-document/v1-0123456789abcdef0123456789abcdef.png`,
    ]);
  });
});

describe('a partition named with the raw digest', () => {
  it('still compares, in both lookup tiers', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'button' }, rasterOf(MAC, 'v1:doc', 'QUJD'));
    await spellWithColon(root, MAC);

    const found = await store.find({ subject: 'button' }, MAC);
    expect(found?.comparable).toBe(true);
    expect(found?.raster.bytes).toBe('QUJD');
    expect((await store.describe({ subject: 'button' }, MAC))?.comparable).toBe(true);
  });

  it('is another machine`s partition when another machine wrote it', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'button' }, rasterOf(RUNNER));
    await spellWithColon(root, RUNNER);

    const found = await store.find({ subject: 'button' }, MAC);
    expect(found?.comparable).toBe(false);
    expect(found?.storedUnder).toEqual(RUNNER);
    expect((await store.describe({ subject: 'button' }, MAC))?.comparable).toBe(false);
  });

  it('is read ahead of another machine`s partition, so a comparable baseline wins', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'button' }, rasterOf(MAC, 'v1:doc', 'TUFD'));
    await store.put({ subject: 'button' }, rasterOf(RUNNER, 'v1:doc', 'UlVO'));
    await spellWithColon(root, MAC);

    const found = await store.find({ subject: 'button' }, MAC);
    expect(found?.comparable).toBe(true);
    expect(found?.raster.bytes).toBe('TUFD');
  });

  it('is found beside a component under a `beside` layout, and never mistaken for one', async () => {
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put({ subject: 'ui/Button/primary' }, rasterOf(RUNNER));
    await spellWithColon(join(root, 'ui', 'Button'), RUNNER);

    const found = await store.find({ subject: 'ui/Button/primary' }, MAC);
    expect(found?.comparable).toBe(false);
    expect(found?.storedUnder).toEqual(RUNNER);
  });

  it('is moved by the next `put`, leaving one copy under the written name', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'button' }, rasterOf(MAC, 'v1:doc', 'QUJD'));
    await spellWithColon(root, MAC);

    await store.put({ subject: 'button' }, rasterOf(MAC, 'v1:doc', 'REVG'));

    expect(await readdir(root)).toEqual([digestFileName(identityDigest(MAC))]);
    expect((await store.find({ subject: 'button' }, MAC))?.raster.bytes).toBe('REVG');
  });

  it('keeps the subjects a `put` did not name', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'button' }, rasterOf(MAC));
    await store.put({ subject: 'card' }, rasterOf(MAC));
    await spellWithColon(root, MAC);

    await store.put({ subject: 'button' }, rasterOf(MAC, 'v1:doc', 'REVG'));

    expect(await readdir(join(root, identityDigest(MAC)))).toEqual(['card.json', 'card.png']);
    expect((await store.find({ subject: 'card' }, MAC))?.comparable).toBe(true);
  });

  it('holds planned subjects the plan names, and names the ones it does not', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'home.html' }, rasterOf(MAC));
    await store.put({ subject: 'blog.html' }, rasterOf(MAC));
    await spellWithColon(root, MAC);

    expect(await store.unplanned?.([{ subject: 'home.html' }], MAC)).toEqual(['blog.html']);
  });
});
