import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestFileName, fileNameFor, identityDigest, type Raster, type RenderIdentity } from '@variance-authority/core/format';
import { createDurableStore } from './durable.js';

/**
 * What the store holds and the plan did not name (ADR-0063).
 *
 * The answer is a set difference taken over paths, and named by the path, which
 * is what a person finds in the checkout. Every test here is about a path the
 * walk must or must not reach: another engine's file, the render cache sharing a
 * root, a subject approved with no pixels, and the layout before
 * `baselines.path`.
 */

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

/** Another engine: the file these tests must not cross. */
const FIREFOX: RenderIdentity = { ...MAC, renderer: 'playwright-firefox', engine: 'firefox@133.0' };

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

    expect(await store.unplanned?.([{ subject: 'home.html' }], MAC)).toEqual(['blog.html-chromium']);
  });

  it('says nothing when the plan covers what is held', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'home.html' }, rasterOf(MAC));

    expect(await store.unplanned?.([{ subject: 'home.html' }], MAC)).toEqual([]);
  });

  // A story the run did not visit has widths the run never read. Every width
  // of it is planned; a story whose id merely shares its prefix, or differs
  // from it by a digit, is not one of its widths.
  it('counts any width of a subject whose widths are unknown, and nothing else', async () => {
    const store = createDurableStore(root);
    const h1 = (width: number) => ({ subject: `story:heading--h1@${width}`, title: 'Heading', name: `H1 @${width}` });
    await store.put(h1(375), rasterOf(MAC));
    await store.put(h1(1280), rasterOf(MAC));
    await store.put({ subject: 'story:heading--h2@375', title: 'Heading', name: 'H2 @375' }, rasterOf(MAC));
    await store.put({ subject: 'story:heading--h1-large@375', title: 'Heading', name: 'H1 large @375' }, rasterOf(MAC));
    await store.put({ subject: 'story:heading--h1', title: 'Heading', name: 'H1' }, rasterOf(MAC));

    expect(await store.unplanned?.([], MAC, [h1])).toEqual([
      'Heading/H1-chromium',
      'Heading/H1-large-375-chromium',
      'Heading/H2-375-chromium',
    ]);
  });

  // Every template spells {name} or {id}, and a width spells itself in both, so
  // this is a key that does not: where no path differs by width, no held path is
  // one of its widths, and nothing is counted beyond what the plan addresses.
  it('counts no width for a key whose path does not part by width', async () => {
    const store = createDurableStore(root);
    const h1 = (width: number) => ({ subject: `story:heading--h1@${width}`, title: 'Heading', name: 'H1' });
    await store.put(h1(375), rasterOf(MAC));

    expect(await store.unplanned?.([], MAC, [h1])).toEqual(['Heading/H1-chromium']);
  });

  // A run of one engine has no opinion about another engine's baselines: a
  // Chromium run planning nothing would otherwise call every Firefox file
  // unwatched.
  it('ignores baselines of another engine', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'blog.html' }, rasterOf(FIREFOX));

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

    expect(await store.unplanned?.([], MAC)).toEqual(['empty.html-chromium']);
  });

  // The template scatters baselines through directories, so the scan has to
  // walk — and the directories it walked through are part of the name, because
  // `primary` alone names three different components.
  it('walks the template`s directories and keeps them in the name', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'components/Button/primary' }, rasterOf(MAC));
    await store.put({ subject: 'components/Card/primary' }, rasterOf(MAC));

    expect(await store.unplanned?.([{ subject: 'components/Card/primary' }], MAC)).toEqual([
      'components/Button/primary-chromium',
    ]);
  });

  it('walks beside the declaring files under a collocated template', async () => {
    const path = '{dir}/__baselines__/{file}/{name}-{engine}';
    const store = createDurableStore(root, { path });
    const button = { subject: 'button--primary', file: 'src/Button.stories.tsx', name: 'Primary' };
    const card = { subject: 'card--primary', file: 'src/Card.stories.tsx', name: 'Primary' };
    await store.put(button, rasterOf(MAC));
    await store.put(card, rasterOf(MAC));

    expect(await store.unplanned?.([card], MAC)).toEqual([
      'src/__baselines__/Button.stories.tsx/Primary-chromium',
    ]);
  });

  // An upgrade has not yet moved what the layout before `baselines.path` wrote,
  // and a subject the plan dropped is still dropped there. It is named by its
  // id, the partition left out, because the id is what that layout spelled.
  it('names a dropped subject the old layout still holds, by its id', async () => {
    const old = join(root, digestFileName(identityDigest(MAC)));
    await mkdir(old, { recursive: true });
    await writeFile(join(old, `${fileNameFor('docs/guide/start')}.json`), JSON.stringify(rasterOf(MAC)));

    expect(await createDurableStore(root).unplanned?.([], MAC)).toEqual(['docs/guide/start']);
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

      expect(await store.unplanned?.([], MAC)).toEqual(['blog.html-chromium']);
    } finally {
      await rm(records, { recursive: true, force: true });
    }
  });
});
