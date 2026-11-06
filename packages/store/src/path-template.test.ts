import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { RasterStoreError, type BaselineKey } from '@variance-authority/raster';
import { createDurableStore } from './durable.js';
import { parseBaselinePath } from './path-template.js';
import { RED } from './image.fixture.js';

/**
 * The path a committed baseline is reviewed by: what the subject is, read off
 * the file name, and where the operator put it.
 *
 * Driven through `createDurableStore` and read back off the disk, because the
 * claim is about what a pull request lists afterwards.
 */

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

const WEBKIT: RenderIdentity = { ...MAC, renderer: 'playwright-webkit', engine: 'webkit@18.2' };

function rasterOf(identity: RenderIdentity, digest = 'v1:doc', bytes = RED): Raster {
  return { documentDigest: digest, identity, width: 10, height: 10, bytes, missingFonts: [] };
}

const PRIMARY: BaselineKey = {
  subject: 'story:components-button--primary',
  file: 'src/ui/Button.stories.tsx',
  title: 'Components/Button',
  name: 'Primary',
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-path-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function tree(at = root, prefix = ''): Promise<readonly string[]> {
  const found: string[] = [];
  for (const entry of await readdir(at, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await tree(join(at, entry.name), path)));
    else found.push(path);
  }
  return found.sort();
}

describe('the default path', () => {
  it('names the image after the subject`s title, name and engine', async () => {
    await createDurableStore(root).put(PRIMARY, rasterOf(MAC));

    expect(await tree()).toEqual(['Components/Button/Primary-chromium.json', 'Components/Button/Primary-chromium.webp']);
  });

  it('reads the title off the id when the collector names none', async () => {
    await createDurableStore(root).put({ subject: 'checkout/cart/empty' }, rasterOf(MAC));

    expect(await tree()).toEqual(['checkout/cart/empty-chromium.json', 'checkout/cart/empty-chromium.webp']);
  });

  it('keeps a label beside the name', async () => {
    await createDurableStore(root).put({ ...PRIMARY, label: 'hover' }, rasterOf(MAC));

    expect(await tree()).toContain('Components/Button/Primary__hover-chromium.webp');
  });

  it('finds what it wrote, as this machine`s baseline', async () => {
    const store = createDurableStore(root);
    await store.put(PRIMARY, rasterOf(MAC));

    const found = await store.find(PRIMARY, MAC);
    expect(found?.comparable).toBe(true);
    expect(found?.relocated).toBeUndefined();
  });
});

describe('a template the operator writes', () => {
  it('puts the image beside the file that declares it', async () => {
    const store = createDurableStore(root, { path: '{dir}/__baselines__/{file}/{name}-{engine}' });
    await store.put(PRIMARY, rasterOf(MAC));
    await store.put({ ...PRIMARY, subject: 'story:root--only', file: 'Root.stories.tsx', name: 'Only' }, rasterOf(MAC));

    expect(await tree()).toEqual([
      '__baselines__/Root.stories.tsx/Only-chromium.json',
      '__baselines__/Root.stories.tsx/Only-chromium.webp',
      'src/ui/__baselines__/Button.stories.tsx/Primary-chromium.json',
      'src/ui/__baselines__/Button.stories.tsx/Primary-chromium.webp',
    ]);
  });

  it('spells a whole id as one readable name', async () => {
    await createDurableStore(root, { path: '{id}' }).put({ subject: 'story:components-button--primary' }, rasterOf(MAC));

    expect(await tree()).toEqual(['story-components-button--primary.json', 'story-components-button--primary.webp']);
  });

  it('refuses a {file} for a subject no file declares, naming the subject', async () => {
    const store = createDurableStore(root, { path: '{dir}/{file}/{name}' });

    await expect(store.put({ subject: 'route:/checkout' }, rasterOf(MAC))).rejects.toThrow(/route:\/checkout.*\{dir\} or \{file\}/);
  });

  // The declaring file comes off a collector's index, not off the operator's
  // config, so the refusal names the subject the operator does know.
  it.each([
    ['../../etc/Button.stories.tsx', /story:a--x.*not a\s+normalized path/s],
    ['/etc/Button.stories.tsx', /story:a--x.*not a\s+normalized path/s],
    ['src/./Button.stories.tsx', /story:a--x.*not a\s+normalized path/s],
  ])('refuses a declaring file %j that would place a baseline outside the root', async (file, why) => {
    const store = createDurableStore(root, { path: '{dir}/__baselines__/{file}/{name}-{engine}' });

    await expect(store.put({ subject: 'story:a--x', file, name: 'X' }, rasterOf(MAC))).rejects.toThrow(why);
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it.each([
    ['', /is empty/],
    ['../{name}', /"\.\." segment/],
    ['/abs/{name}', /relative path/],
    ['{title}/{nme}', /\{nme\}, which is no token/],
    ['{title}/{name', /brace/],
    ['x{title}/{name}', /stands alone/],
    ['{title}/{engine}', /neither \{name\} nor \{id\}/],
    ['{name}.png', /extension/],
    ['{name}.webp', /extension/],
    ['{name}/{title}', /ends in \{title\}/],
  ])('refuses %j', (template, why) => {
    expect(() => parseBaselinePath(template)).toThrow(why);
  });

  it('globs every path it can render', () => {
    expect(parseBaselinePath('{title}/{name}-{engine}').glob).toBe('**/*-*');
    expect(parseBaselinePath('{dir}/__baselines__/{file}/{name}-{engine}').glob).toBe('**/__baselines__/*/*-*');
  });

  // A glob with a directory of its own takes nothing but baselines, wherever
  // its root is; one without takes every image its pattern happens to spell.
  it.each([
    ['{title}/{name}-{engine}', false],
    ['{dir}/{file}/{name}-{engine}', false],
    ['{dir}/__baselines__/{file}/{name}-{engine}', true],
    ['shots/{title}/{name}', true],
  ])('says whether %j names a directory of its own', (template, anchored) => {
    expect(parseBaselinePath(template).anchored).toBe(anchored);
  });

  it('files each Playwright project apart under {project}', async () => {
    const store = createDurableStore(root, { path: '{project}/{title}/{name}-{engine}' });
    await store.put({ ...PRIMARY, project: 'desktop' }, rasterOf(MAC));
    await store.put({ ...PRIMARY, project: 'mobile' }, rasterOf(MAC));

    expect(await tree()).toEqual([
      'desktop/Components/Button/Primary-chromium.json',
      'desktop/Components/Button/Primary-chromium.webp',
      'mobile/Components/Button/Primary-chromium.json',
      'mobile/Components/Button/Primary-chromium.webp',
    ]);
  });

  it('refuses {project} for a subject no project observed, naming the subject', async () => {
    const store = createDurableStore(root, { path: '{project}/{name}' });

    await expect(store.put(PRIMARY, rasterOf(MAC))).rejects.toThrow(/story:components-button--primary.*\{project\}/s);
  });
});

describe('two subjects on one path', () => {
  const twin: BaselineKey = { ...PRIMARY, subject: 'story:components-button--primary-2', name: 'Primary?' };

  it('refuses the second, naming both, and renumbers neither', async () => {
    const store = createDurableStore(root);
    await store.put(PRIMARY, rasterOf(MAC));

    const refused: unknown = await store.put(twin, rasterOf(MAC)).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RasterStoreError);
    expect((refused as Error).message).toContain('"story:components-button--primary"');
    expect((refused as Error).message).toContain('"story:components-button--primary-2"');
    expect(await tree()).toEqual(['Components/Button/Primary-chromium.json', 'Components/Button/Primary-chromium.webp']);
  });

  it('refuses them when the run declares them, before anything is read', () => {
    const store = createDurableStore(root);

    expect(() => store.expect?.([PRIMARY, twin])).toThrow(/Components\/Button\/Primary-\{engine\} under/);
  });

  // A shard, a skipped subject and a Playwright worker each hold a store of
  // their own, so the claim one of them holds in memory is not the other's.
  // The record beside the image says whose baseline it is.
  it('refuses a path a store elsewhere accepted for another subject, by its record', async () => {
    await createDurableStore(root).put(PRIMARY, rasterOf(MAC));
    const elsewhere = createDurableStore(root);

    await expect(elsewhere.find(twin, MAC)).rejects.toThrow(
      /"story:components-button--primary".*"story:components-button--primary-2"/s,
    );
    await expect(createDurableStore(root).put(twin, rasterOf(MAC))).rejects.toThrow(RasterStoreError);
    // The refused write left the first subject's baseline as it was.
    expect((await createDurableStore(root).find(PRIMARY, MAC))?.comparable).toBe(true);
  });

  it('refuses a second Playwright project on one path, and names {project}', async () => {
    // Two projects that differ only in scale factor, colour scheme or viewport
    // run one test as one subject. Without {project} they would take turns
    // overwriting one file, each reading the other's image as its baseline.
    await createDurableStore(root).put({ ...PRIMARY, project: 'desktop' }, rasterOf(MAC));
    const mobile = createDurableStore(root);

    await expect(mobile.find({ ...PRIMARY, project: 'mobile' }, { ...MAC, deviceScaleFactor: 2 })).rejects.toThrow(
      /"desktop".*"mobile".*\{project\}/s,
    );
  });

  it('takes over the baseline a renamed project left, and still refuses a project that runs', async () => {
    // `mobile` was renamed `narrow`: no run will place for `mobile` again, so
    // its record is stale, not a second claimant.
    await createDurableStore(root).put({ ...PRIMARY, project: 'mobile' }, rasterOf(MAC));
    const renamed = createDurableStore(root, { projects: ['desktop', 'narrow'] });

    expect((await renamed.find({ ...PRIMARY, project: 'narrow' }, MAC))?.comparable).toBe(true);
    await renamed.put({ ...PRIMARY, project: 'narrow' }, rasterOf(MAC));

    const running = createDurableStore(root, { projects: ['desktop', 'narrow'] });
    await expect(running.find({ ...PRIMARY, project: 'desktop' }, MAC)).rejects.toThrow(/"narrow".*"desktop"/s);
  });

  it('refuses the second of two workers that both write a path nobody held, and keeps the first', async () => {
    // Neither read a record, so neither refused on reading: the write itself
    // must be the claim, or the last one to finish overwrites the first.
    const outcomes = await Promise.allSettled([
      createDurableStore(root).put(PRIMARY, rasterOf(MAC, 'v1:a')),
      createDurableStore(root).put(twin, rasterOf(MAC, 'v1:b')),
    ]);

    const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(RasterStoreError);
    const winner = outcomes[0]!.status === 'fulfilled' ? PRIMARY : twin;
    expect((await createDurableStore(root).find(winner, MAC))?.comparable).toBe(true);
  });

  it('repairs a record that does not parse, rather than blaming a writer that is not there', async () => {
    // A merge that both sides accepted leaves conflict markers in the committed
    // record; the accept that follows is how the operator resolves it.
    const record = join(root, 'Components/Button/Primary-chromium.json');
    await createDurableStore(root).put(PRIMARY, rasterOf(MAC, 'v1:a'));
    await writeFile(record, '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> theirs\n');

    await createDurableStore(root).put(PRIMARY, rasterOf(MAC, 'v1:b'));
    expect((await createDurableStore(root).find(PRIMARY, MAC))?.comparable).toBe(true);
  });

  it('still refuses another subject over a damaged pair whose record names the first', async () => {
    await createDurableStore(root).put(PRIMARY, rasterOf(MAC));
    await rm(join(root, 'Components/Button/Primary-chromium.webp'));

    await expect(createDurableStore(root).put(twin, rasterOf(MAC))).rejects.toThrow(RasterStoreError);
  });

  it('does not check a record written before records named their subject', async () => {
    // Such a record carries no claim to compare against; the store's own
    // in-memory claim is all it gets, and the next accept stamps it.
    const store = createDurableStore(root);
    await store.put(PRIMARY, rasterOf(MAC));
    const record = join(root, 'Components/Button/Primary-chromium.json');
    const { placedFor: _, ...unnamed } = JSON.parse(await readFile(record, 'utf8')) as Record<string, unknown>;
    await writeFile(record, JSON.stringify(unnamed));

    expect((await createDurableStore(root).find(twin, MAC))?.comparable).toBe(true);
    await createDurableStore(root).put(twin, rasterOf(MAC));
    expect(JSON.parse(await readFile(record, 'utf8'))).toMatchObject({ placedFor: { subject: twin.subject } });
  });

  it('folds case, because a checkout on macOS does, and names both spellings', async () => {
    const store = createDurableStore(root);
    await store.put(PRIMARY, rasterOf(MAC));

    await expect(store.find({ ...PRIMARY, subject: 'story:other', name: 'primary' }, MAC)).rejects.toThrow(
      /story:other.*Components\/Button\/Primary-chromium and Components\/Button\/primary-chromium/,
    );
  });
});

describe('the identity lives in the record', () => {
  it('overwrites in place when another machine accepts', async () => {
    const store = createDurableStore(root);
    await store.put(PRIMARY, rasterOf(MAC, 'v1:a'));
    await store.put(PRIMARY, rasterOf({ ...MAC, platform: 'linux/x64' }, 'v1:b'));

    expect(await tree()).toEqual(['Components/Button/Primary-chromium.json', 'Components/Button/Primary-chromium.webp']);
    const found = await store.find(PRIMARY, MAC);
    expect(found?.comparable).toBe(false);
    expect(found?.storedUnder.platform).toBe('linux/x64');
  });

  it('reads another engine`s file when this engine has none', async () => {
    const store = createDurableStore(root);
    await store.put(PRIMARY, rasterOf(WEBKIT));

    const found = await store.describe(PRIMARY, MAC);
    expect(found?.comparable).toBe(false);
    expect(found?.storedUnder.engine).toBe('webkit@18.2');
  });

  it('names a held baseline the plan dropped by its path', async () => {
    const store = createDurableStore(root);
    const gone: BaselineKey = { ...PRIMARY, subject: 'story:components-button--gone', name: 'Gone' };
    await store.put(PRIMARY, rasterOf(MAC));
    await store.put(gone, rasterOf(MAC));
    await store.put(gone, rasterOf(WEBKIT));

    expect(await store.unplanned?.([PRIMARY], MAC)).toEqual(['Components/Button/Gone-chromium']);
  });
});
