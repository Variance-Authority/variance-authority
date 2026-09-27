import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { digestFileName, identityDigest } from '@variance-authority/core/format';
import { RasterStoreError } from '@variance-authority/raster';
import { createDurableStore } from './durable.js';

/** The directory a store names for this identity's partition. */
const partition = (identity: RenderIdentity): string => digestFileName(identityDigest(identity));

/**
 * Where a file lands, which is the one thing about a store that reaches no
 * verdict.
 *
 * Driven through `createDurableStore` rather than against `placement.ts`
 * directly, because the claim being made is about what is on disk afterwards: a
 * unit test of `holder()` would pass just as happily against a store that
 * computed the path and then wrote somewhere else.
 */

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

/** Same browser, different machine. The case the identity partition exists for. */
const RUNNER: RenderIdentity = { ...MAC, platform: 'linux/x64' };

function rasterOf(identity: RenderIdentity, digest = 'v1:doc', bytes = 'AAAA'): Raster {
  return { documentDigest: digest, identity, width: 10, height: 10, bytes, missingFonts: [] };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-placement-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * The `beside` layout: a baseline in the directory holding the thing it depicts.
 *
 * The placement exists so baselines arrive with a checkout, move when a component
 * moves, and are deleted by the commit that deletes it. What must not move with
 * it is the identity partition — a baseline painted elsewhere still has to land
 * somewhere this machine does not read.
 */
describe('the beside layout', () => {
  it('puts the image in the subject`s own directory', async () => {
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put({ subject: 'src/ui/Button/primary' }, rasterOf(MAC, 'v1:doc', 'QUJD'));

    const files = await readdir(join(root, 'src', 'ui', 'Button', partition(MAC)));

    expect(files.sort()).toEqual(['primary.json', 'primary.png']);
  });

  it('round-trips through the directory it wrote to', async () => {
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put({ subject: 'src/ui/Button/primary' }, rasterOf(MAC, 'v1:doc', 'QUJD'));

    const found = await store.find({ subject: 'src/ui/Button/primary' }, MAC);

    expect(found?.comparable).toBe(true);
    expect(found?.raster.bytes).toBe('QUJD');
  });

  it('still refuses another machine`s baseline as incomparable', async () => {
    // The sibling scan moved down to the leaf directory; it did not go away.
    // Losing it here would turn a wrong-machine run back into `new`, which is
    // the one downgrade this whole layout is not allowed to buy.
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put({ subject: 'src/ui/Button/primary' }, rasterOf(RUNNER));

    const found = await store.find({ subject: 'src/ui/Button/primary' }, MAC);

    expect(found?.comparable).toBe(false);
    expect(found?.storedUnder.platform).toBe('linux/x64');
  });

  it('does not read a neighbouring component`s directory as a machine identity', async () => {
    // `beside` puts partitions among ordinary directories. A scan that took
    // `Button/` for a machine would answer `incomparable` naming a component.
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put({ subject: 'src/ui/Button/primary' }, rasterOf(MAC));
    await store.put({ subject: 'src/ui/Card/primary' }, rasterOf(MAC));

    expect(await store.find({ subject: 'src/ui/missing' }, MAC)).toBeNull();
  });

  it('refuses a subject id that would write outside the root', async () => {
    // The only layout whose write location is steered by the plan, so it is the
    // only one where a collector naming a subject `../../etc/hosts` matters.
    const store = createDurableStore(root, { layout: 'beside' });

    await expect(
      store.put({ subject: '../escaped/primary' }, rasterOf(MAC)),
    ).rejects.toThrow(RasterStoreError);
  });

  it('is not what a flat store does with the same id', async () => {
    const store = createDurableStore(root, { layout: 'flat' });
    await store.put({ subject: 'src/ui/Button/primary' }, rasterOf(MAC));

    const files = await readdir(join(root, partition(MAC)));

    expect(files.sort()).toEqual(['src%2Fui%2FButton%2Fprimary.json', 'src%2Fui%2FButton%2Fprimary.png']);
  });
});

/**
 * A directory the plan carried, for the subjects whose ids are not paths.
 *
 * A story is `story:components-button--primary` — a namespaced name with no
 * directory in it — and the file that declares it is known to the artifact that
 * produced the plan and to nothing downstream. Without this the whole Storybook
 * case falls back to the root, which is the one placement that is worse than
 * `flat`: every image in one heap *and* that heap in the source tree.
 */
describe('the beside layout, given a path', () => {
  const story = { subject: 'story:components-button--primary', path: 'src/ui/Button' };

  it('places by the path rather than by the id', async () => {
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put(story, rasterOf(MAC, 'v1:doc', 'QUJD'));

    const files = await readdir(join(root, 'src', 'ui', 'Button', partition(MAC)));

    expect(files.sort()).toEqual([
      'story%3Acomponents-button--primary.json',
      'story%3Acomponents-button--primary.png',
    ]);
  });

  it('round-trips, and settles from the sidecar in the same directory', async () => {
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put(story, rasterOf(MAC, 'v1:doc', 'QUJD'));

    expect((await store.find(story, MAC))?.raster.bytes).toBe('QUJD');
    expect((await store.describe(story, MAC))?.documentDigest).toBe('v1:doc');
  });

  it('keeps the whole id as the name, so two directories cannot collide', async () => {
    // The id is not a path, so there is no leading segment the directory has
    // already accounted for. Trimming to the last `/`-separated piece would be
    // trimming nothing here and would silently mean something else the day a
    // collector namespaces with slashes.
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put({ subject: 'story:a--x', path: 'src/One' }, rasterOf(MAC));
    await store.put({ subject: 'story:b--x', path: 'src/Two' }, rasterOf(MAC));

    expect(await readdir(join(root, 'src', 'One', partition(MAC)))).toEqual([
      'story%3Aa--x.json',
      'story%3Aa--x.png',
    ]);
  });

  it('reads an empty path as the root, because a root is a place', async () => {
    // A component declared at the top of the repository. Refusing this would
    // make the root the one directory a project may not keep code in.
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put({ subject: 'story:a--x', path: '' }, rasterOf(MAC, 'v1:doc', 'QUJD'));

    expect((await store.find({ subject: 'story:a--x', path: '' }, MAC))?.raster.bytes).toBe('QUJD');
  });

  it('refuses a carried path that climbs out of the root', async () => {
    const store = createDurableStore(root, { layout: 'beside' });

    await expect(
      store.put({ subject: 'story:a--x', path: '../../etc' }, rasterOf(MAC)),
    ).rejects.toThrow(RasterStoreError);
  });

  it('refuses an absolute carried path', async () => {
    const store = createDurableStore(root, { layout: 'beside' });

    await expect(
      store.put({ subject: 'story:a--x', path: '/etc' }, rasterOf(MAC)),
    ).rejects.toThrow(/absolute path/);
  });

  it('names the subject in the refusal, because the path came off an artifact', async () => {
    // The operator chose the subject and did not choose the path. A message
    // quoting only the path leaves them grepping a built index for it.
    const store = createDurableStore(root, { layout: 'beside' });

    await expect(
      store.put({ subject: 'story:a--x', path: '../up' }, rasterOf(MAC)),
    ).rejects.toThrow(/story:a--x/);
  });

  it('is ignored by a flat store, which has nowhere to put it', async () => {
    const store = createDurableStore(root, { layout: 'flat' });
    await store.put(story, rasterOf(MAC));

    const files = await readdir(join(root, partition(MAC)));

    expect(files.sort()).toEqual([
      'story%3Acomponents-button--primary.json',
      'story%3Acomponents-button--primary.png',
    ]);
  });
});
