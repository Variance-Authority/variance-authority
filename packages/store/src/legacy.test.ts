import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestFileName, fileNameFor, identityDigest, type Raster, type RenderIdentity } from '@variance-authority/core/format';
import type { BaselineKey } from '@variance-authority/raster';
import { createDurableStore } from './durable.js';
import { RED, asPng } from './image.fixture.js';

/**
 * A repository that kept its baselines under the identity partition upgrades
 * to `baselines.path`. Its baselines are still its baselines: read, compared,
 * and moved by the next accept, never reported `new`.
 *
 * The old layout is written by hand, as it sits in such a repository, because
 * nothing in the store writes it any more.
 */

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

function rasterOf(identity: RenderIdentity, digest = 'v1:doc'): Raster {
  return { documentDigest: digest, identity, width: 10, height: 10, bytes: RED, missingFonts: [] };
}

const PRIMARY: BaselineKey = {
  subject: 'story:components-button--primary',
  file: 'src/ui/Button.stories.tsx',
  title: 'Components/Button',
  name: 'Primary',
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-legacy-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A pair where the identity-partitioned layout put it: `<holder>/v1-<hex>/<leaf>`. */
async function legacyPair(holder: string, leaf: string, raster: Raster): Promise<string> {
  const directory = join(holder, digestFileName(identityDigest(raster.identity)));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${leaf}.png`), Buffer.from(asPng(raster.bytes!), 'base64'));
  await writeFile(join(directory, `${leaf}.json`), JSON.stringify({ ...raster, bytes: undefined }));
  return directory;
}

describe('a baseline the flat layout kept', () => {
  it('is found, as this machine`s, with the move named', async () => {
    await legacyPair(root, fileNameFor(PRIMARY.subject), rasterOf(MAC));
    const store = createDurableStore(root);

    const found = await store.find(PRIMARY, MAC);
    expect(found?.comparable).toBe(true);
    expect(found?.relocated).toEqual({
      from: `${digestFileName(identityDigest(MAC))}/story%3Acomponents-button--primary`,
      to: 'Components/Button/Primary-chromium',
    });
    expect((await store.describe(PRIMARY, MAC))?.relocated?.to).toBe('Components/Button/Primary-chromium');
  });

  it('moves to the template path on the next write, leaving nothing behind', async () => {
    const partition = await legacyPair(root, fileNameFor(PRIMARY.subject), rasterOf(MAC));
    const store = createDurableStore(root);

    await store.put(PRIMARY, rasterOf(MAC));

    expect(await readdir(root)).toEqual(['Components']);
    await expect(readdir(partition)).rejects.toThrow(/ENOENT/);
    expect((await store.find(PRIMARY, MAC))?.relocated).toBeUndefined();
  });
});

describe('a baseline the beside layout kept', () => {
  it('is found in the declaring file`s directory', async () => {
    await legacyPair(join(root, 'src', 'ui'), fileNameFor(PRIMARY.subject), rasterOf(MAC));
    const store = createDurableStore(root, { path: '{dir}/__baselines__/{file}/{name}-{engine}' });

    const found = await store.describe(PRIMARY, MAC);
    expect(found?.relocated).toEqual({
      from: `src/ui/${digestFileName(identityDigest(MAC))}/story%3Acomponents-button--primary`,
      to: 'src/ui/__baselines__/Button.stories.tsx/Primary-chromium',
    });
  });

  it('is found under the id`s own directories when no file was carried', async () => {
    await legacyPair(join(root, 'checkout', 'cart'), 'empty', rasterOf(MAC));
    const store = createDurableStore(root);

    expect((await store.find({ subject: 'checkout/cart/empty' }, MAC))?.relocated?.from).toBe(
      `checkout/cart/${digestFileName(identityDigest(MAC))}/empty`,
    );
  });
});

describe('an accept on an upgraded repository', () => {
  it('retires only its own line`s old pair: another scale is another project`s baseline', async () => {
    const retina: RenderIdentity = { ...MAC, deviceScaleFactor: 2 };
    const leaf = fileNameFor(PRIMARY.subject);
    await legacyPair(root, leaf, rasterOf(MAC));
    const kept = await legacyPair(root, leaf, rasterOf(retina));
    const path = '{project}/{title}/{name}-{engine}';

    await createDurableStore(root, { path }).put({ ...PRIMARY, project: 'desktop' }, rasterOf(MAC));

    expect((await readdir(kept)).sort()).toEqual([`${leaf}.json`, `${leaf}.png`]);
    const found = await createDurableStore(root, { path }).find({ ...PRIMARY, project: 'retina' }, retina);
    expect(found?.comparable).toBe(true);
    expect(found?.relocated?.to).toBe('retina/Components/Button/Primary-chromium');
  });
});
