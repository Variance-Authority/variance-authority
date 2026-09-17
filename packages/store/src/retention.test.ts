import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { identityDigest } from '@variance-authority/core/format';
import { createDurableStore } from './durable.js';
import { sweepRenderCache } from './retention.js';

/**
 * The bound on a directory nothing else was ever going to reach.
 *
 * Two properties carry the whole of it: an entry the run wanted is an entry
 * with a fresh timestamp, and an entry the sweep took is an entry both of whose
 * halves are gone. Everything else here is about the sweep refusing to be a
 * reason a run fails.
 */

const DAY = 24 * 60 * 60 * 1000;

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

/** Same browser, upgraded. The identity that stops being rendered under. */
const OLDER: RenderIdentity = { ...MAC, engine: 'chromium@130.0.0' };

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-renders-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** An entry as `renderCache.put` leaves one, aged to taste. */
async function entry(
  identity: RenderIdentity,
  digest: string,
  options: { bytes?: number; agedDays?: number } = {},
): Promise<string> {
  const directory = join(root, identityDigest(identity), 'by-document');
  await mkdir(directory, { recursive: true });
  const path = join(directory, digest);
  await writeFile(`${path}.png`, Buffer.alloc(options.bytes ?? 1024));
  await writeFile(`${path}.json`, '{}\n', 'utf8');

  if (options.agedDays !== undefined) {
    const when = new Date(Date.now() - options.agedDays * DAY);
    await utimes(`${path}.png`, when, when);
    await utimes(`${path}.json`, when, when);
  }
  return path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('a render cache that prunes itself', () => {
  it('drops an entry no run has asked for, and keeps the one that was', async () => {
    const stale = await entry(MAC, 'v1:stale', { agedDays: 30 });
    const wanted = await entry(MAC, 'v1:wanted');

    const swept = await sweepRenderCache(root, { maxAgeMs: 14 * DAY });

    expect(swept.found).toBe(2);
    expect(swept.removed).toBe(1);
    expect(await exists(`${stale}.png`)).toBe(false);
    // Both halves. A `.png` without its `.json` is not an absent entry, it is a
    // corrupt one, and the reader is entitled to say so out loud.
    expect(await exists(`${stale}.json`)).toBe(false);
    expect(await exists(`${wanted}.png`)).toBe(true);
    expect(await exists(`${wanted}.json`)).toBe(true);
  });

  it('cuts to the ceiling oldest first, and stops as soon as it is under', async () => {
    const oldest = await entry(MAC, 'v1:a', { bytes: 4000, agedDays: 3 });
    const middle = await entry(MAC, 'v1:b', { bytes: 4000, agedDays: 2 });
    const newest = await entry(MAC, 'v1:c', { bytes: 4000, agedDays: 1 });

    // Room for two of the three, so exactly one eviction answers it — a sweep
    // that emptied the directory whenever the ceiling bit would make the first
    // wide suite cost every later run a full repaint.
    const swept = await sweepRenderCache(root, { maxAgeMs: 14 * DAY, ceilingBytes: 9000 });

    expect(swept.removed).toBe(1);
    expect(await exists(`${oldest}.png`)).toBe(false);
    expect(await exists(`${middle}.png`)).toBe(true);
    expect(await exists(`${newest}.png`)).toBe(true);
    expect(swept.held).toBeLessThanOrEqual(9000);
  });

  it('takes the empty shell of an identity nothing renders under any more', async () => {
    await entry(OLDER, 'v1:gone', { agedDays: 30 });
    await entry(MAC, 'v1:here');

    const swept = await sweepRenderCache(root, { maxAgeMs: 14 * DAY });

    expect(swept.identities).toBe(1);
    expect(await readdir(root)).toEqual([identityDigest(MAC)]);
  });

  it('leaves an identity alone while it still holds something', async () => {
    await entry(OLDER, 'v1:kept');
    await entry(MAC, 'v1:kept');

    const swept = await sweepRenderCache(root, { maxAgeMs: 14 * DAY });

    expect(swept.removed).toBe(0);
    expect((await readdir(root)).sort()).toEqual([identityDigest(MAC), identityDigest(OLDER)].sort());
  });

  it('takes the directory itself once nothing is left in it', async () => {
    // The machine that moved to CI against a tribunal. Nothing renders here
    // again, so no entry is ever refreshed, every one of them ages out — and
    // what would otherwise remain is an empty directory in a place its owner
    // never chose, which is the complaint this file answers minus the bytes.
    const home = join(root, 'renders');
    await mkdir(home, { recursive: true });
    const inside = join(home, identityDigest(MAC), 'by-document');
    await mkdir(inside, { recursive: true });
    const when = new Date(Date.now() - 30 * DAY);
    await writeFile(join(inside, 'v1:old.png'), Buffer.alloc(1024));
    await writeFile(join(inside, 'v1:old.json'), '{}\n', 'utf8');
    await utimes(join(inside, 'v1:old.png'), when, when);
    await utimes(join(inside, 'v1:old.json'), when, when);

    const swept = await sweepRenderCache(home, { maxAgeMs: 14 * DAY });

    expect(swept.removed).toBe(1);
    expect(await exists(home)).toBe(false);
  });

  it('answers for a root that was never written, rather than throwing', async () => {
    // The ordinary first run: `run` sweeps whether or not anything cached, and a
    // sweep that threw on a cold machine would fail a build over an optimisation.
    const swept = await sweepRenderCache(join(root, 'never'), { maxAgeMs: DAY });

    expect(swept).toMatchObject({ found: 0, removed: 0, freed: 0, held: 0, identities: 0 });
  });
});

describe('the timestamp the sweep reads', () => {
  it('is refreshed by a hit, so a cached subject survives its own age limit', async () => {
    const store = createDurableStore(join(root, 'baselines'), { cacheRoot: root });
    const raster: Raster = {
      documentDigest: 'v1:doc',
      identity: MAC,
      width: 10,
      height: 10,
      bytes: 'AAAA',
      missingFonts: [],
    };
    await store.renderCache.put(raster);

    const path = join(root, identityDigest(MAC), 'by-document', 'v1:doc');
    const long = new Date(Date.now() - 30 * DAY);
    await utimes(`${path}.png`, long, long);
    await utimes(`${path}.json`, long, long);

    // The hit is the only place an entry's value is visible. A digest whose
    // source moved can never be asked for again, so "asked for recently" and
    // "still reachable" are the same statement — and nothing but `get` knows it.
    expect(await store.renderCache.get('v1:doc', MAC)).not.toBeNull();

    const swept = await sweepRenderCache(root, { maxAgeMs: 14 * DAY });
    expect(swept.removed).toBe(0);
    expect(await exists(`${path}.png`)).toBe(true);
  });

  it('is not refreshed by a miss, so nothing resurrects a neighbour', async () => {
    const store = createDurableStore(join(root, 'baselines'), { cacheRoot: root });
    const stale = await entry(MAC, 'v1:stale', { agedDays: 30 });

    expect(await store.renderCache.get('v1:absent', MAC)).toBeNull();

    const swept = await sweepRenderCache(root, { maxAgeMs: 14 * DAY });
    expect(swept.removed).toBe(1);
    expect(await exists(`${stale}.json`)).toBe(false);
  });
});
