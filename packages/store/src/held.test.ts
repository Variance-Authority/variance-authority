import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { createDurableStore } from './durable.js';

/**
 * What the store holds and the plan did not name (ADR-0063).
 *
 * The answer is a set difference taken over paths, so every test here is about
 * a path the walk must or must not reach: another machine's partition, the
 * render cache sharing a root, a subject approved with no pixels, and the two
 * layouts that spell the same id differently.
 */

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

/** Same browser, different machine: the partition these tests must not cross. */
const RUNNER: RenderIdentity = { ...MAC, platform: 'linux/x64' };

function rasterOf(identity: RenderIdentity, digest = 'v1:doc', bytes = 'AAAA'): Raster {
  return { documentDigest: digest, identity, width: 10, height: 10, bytes, missingFonts: [] };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-held-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('unplanned', () => {
  it('names an approved subject the plan no longer contains', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'home.html' }, rasterOf(MAC));
    await store.put({ subject: 'blog.html' }, rasterOf(MAC));

    expect(await store.unplanned?.([{ subject: 'home.html' }], MAC)).toEqual(['blog.html']);
  });

  it('says nothing when the plan covers what is held', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'home.html' }, rasterOf(MAC));

    expect(await store.unplanned?.([{ subject: 'home.html' }], MAC)).toEqual([]);
  });

  // The partition is the point: a baseline another machine approved is not this
  // run's to call unwatched, and reporting it would make every CI-recorded
  // subject unplanned on every laptop.
  it('ignores baselines under another identity', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'blog.html' }, rasterOf(RUNNER));

    expect(await store.unplanned?.([], MAC)).toEqual([]);
  });

  // The cache lives inside the identity partition unless a cache root was split
  // off, and every entry in it is named for a document digest. Read as baselines
  // they would be reported as subjects nobody planned, on every run.
  it('ignores the render cache sharing the root', async () => {
    const store = createDurableStore(root);
    await store.renderCache.put(rasterOf(MAC, 'v1:cached'));

    expect(await store.unplanned?.([], MAC)).toEqual([]);
  });

  // A subject with no pixels is a sidecar and no PNG. Scanning images would
  // report it as one nobody ever approved.
  it('finds a subject that was approved with no pixels', async () => {
    const store = createDurableStore(root);
    await store.put(
      { subject: 'empty.html' },
      { documentDigest: 'v1:doc', identity: MAC, missingFonts: [] },
    );

    expect(await store.unplanned?.([], MAC)).toEqual(['empty.html']);
  });

  it('recovers an id the flat layout had to encode', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'docs/guide/start' }, rasterOf(MAC));

    expect(await store.unplanned?.([], MAC)).toEqual(['docs/guide/start']);
  });

  // `beside` scatters the partitions among the subjects' own directories, so the
  // scan has to walk — and the directories it walked through are part of the
  // name, because `primary` alone names three different components.
  it('walks a beside layout and keeps the directories in the name', async () => {
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put({ subject: 'components/Button/primary' }, rasterOf(MAC));
    await store.put({ subject: 'components/Card/primary' }, rasterOf(MAC));

    expect(await store.unplanned?.([{ subject: 'components/Card/primary' }], MAC)).toEqual([
      'components/Button/primary',
    ]);
  });

  it('answers an empty root rather than failing on it', async () => {
    const store = createDurableStore(join(root, 'not-yet'));

    expect(await store.unplanned?.([], MAC)).toEqual([]);
  });

  // Records and images can live in different roots, and the question is about
  // what was approved: every baseline has a record and only a pictured one has
  // an image.
  it('reads the record root when the two are split', async () => {
    const records = await mkdtemp(join(tmpdir(), 'va-records-'));
    try {
      const store = createDurableStore(root, { recordRoot: records });
      await store.put({ subject: 'blog.html' }, rasterOf(MAC));

      expect(await store.unplanned?.([], MAC)).toEqual(['blog.html']);
    } finally {
      await rm(records, { recursive: true, force: true });
    }
  });
});
