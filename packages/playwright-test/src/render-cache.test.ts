import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  digestFileName,
  identityDigest,
  type Raster,
  type RenderIdentity,
} from '@variance-authority/core/format';
import type { RasterStore } from '@variance-authority/raster';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVariance } from './direct.js';
import { varianceFixtures } from './fixture.js';

/**
 * Where a directory store opened by this package paints, and when that place
 * is bounded.
 *
 * A baseline root is one somebody commits, so the render cache is kept in the
 * checkout's cache, at the place `variance run` keeps it, and swept the way
 * that run sweeps it. `VARIANCE_AUTHORITY_CACHE` is the checkout's cache here,
 * one per test, because the sweep runs once per process for each cache.
 */

const MACHINE: RenderIdentity = {
  renderer: 'fake',
  engine: 'fake@1',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

let root = '';
let cache = '';
let previous: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-playwright-renders-'));
  cache = join(root, 'cache');
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
});

afterEach(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(root, { recursive: true, force: true });
});

const byDocument = (under: string): string =>
  join(under, digestFileName(identityDigest(MACHINE)), 'by-document');

/** An entry no run has asked for in a month. */
async function stale(): Promise<void> {
  const path = join(byDocument(join(cache, 'renders')), 'v1:stale');
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(`${path}.png`, Buffer.alloc(16));
  await writeFile(`${path}.json`, '{}\n', 'utf8');
  const month = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await utimes(`${path}.png`, month, month);
  await utimes(`${path}.json`, month, month);
}

const RASTER: Raster = {
  documentDigest: 'v1:fresh',
  identity: MACHINE,
  width: 1,
  height: 1,
  bytes: Buffer.alloc(8).toString('base64'),
  missingFonts: [],
};

/** The worker fixture as Playwright invokes it. */
const varianceStore = varianceFixtures.varianceStore as unknown as readonly [
  (args: { varianceBaselines: string }, use: (store: RasterStore) => Promise<void>) => Promise<void>,
];

describe('the worker store of the `variance` fixture', () => {
  it('paints into the checkout`s cache, and leaves the baseline root to baselines', async () => {
    const baselines = join(root, 'baselines');

    await varianceStore[0]({ varianceBaselines: baselines }, async (store) => {
      await store.renderCache.put(RASTER);
    });

    expect(await readdir(byDocument(join(cache, 'renders')))).toEqual([
      `${digestFileName('v1:fresh')}.json`,
      `${digestFileName('v1:fresh')}.png`,
    ]);
    await expect(readdir(byDocument(baselines))).rejects.toThrow();
  });

  it('bounds that cache when the worker tears down', async () => {
    await stale();

    await varianceStore[0]({ varianceBaselines: join(root, 'baselines') }, async () => {});

    await expect(readdir(join(cache, 'renders'))).rejects.toThrow();
  });
});

describe('a `createVariance` session', () => {
  /** A page that already carries the agent, so nothing is installed twice. */
  const page = {
    addInitScript: async () => {},
    evaluate: async () => true,
  } as unknown as Page;

  it('bounds the checkout`s render cache when it closes', async () => {
    await stale();

    const session = await createVariance(
      page,
      { id: 'checkout' },
      { baselines: join(root, 'baselines'), bundle: '', materialization: { kind: 'in-place' } },
    );
    await session.close();

    await expect(readdir(join(cache, 'renders'))).rejects.toThrow();
  });
});
