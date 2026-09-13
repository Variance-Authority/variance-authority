import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import { memoryParseCache, openParseCache, type Parsed } from './cache.js';
import { encodeSourceIndex } from './source-index-format.js';

/**
 * A cache keyed by content cannot go stale, so the tests are about the other two
 * ways it can hurt.
 *
 * It can **grow** — a file that keeps every blob any branch ever held eventually
 * costs more to load than the parses it saves, so an unused entry has to fall out
 * without a hit falling out with it. And it can **fail a run** — a corrupt file,
 * an unwritable directory, a file written by an older version of this code. Every
 * one of those is a full scan, which is what would have happened without a cache
 * at all, and none of them is an error anybody should see.
 */

const BUTTON: Parsed = {
  requests: [{ value: './button.css', kind: 'imports', bindings: [] }],
  declares: ['Button'],
};

const TOKENS: Parsed = { requests: [] };

const a: Digest = 'git:1111111111111111111111111111111111111111';
const b: Digest = 'git:2222222222222222222222222222222222222222';

describe('the in-memory cache', () => {
  it('answers with what was parsed from those bytes', () => {
    const cache = memoryParseCache();

    expect(cache.get(a)).toBeUndefined();
    cache.set(a, BUTTON);
    expect(cache.get(a)).toEqual(BUTTON);
  });
});

describe('the cache on disk', () => {
  const made: string[] = [];

  afterAll(async () => {
    for (const dir of made) await rm(dir, { recursive: true, force: true });
  });

  async function path(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'variance-cache-'));
    made.push(dir);
    return join(dir, 'nested', 'parse.bin');
  }

  it('starts empty where no file exists, and creates the directory to save into', async () => {
    const file = await path();
    const cache = await openParseCache(file);

    expect(cache.get(a)).toBeUndefined();
    cache.set(a, BUTTON);
    await cache.save();

    // A first run is the one that has no cache. Making the operator create a
    // directory for it would make the saving opt-in twice.
    expect((await openParseCache(file)).get(a)).toEqual(BUTTON);
  });

  it('keeps an entry this scan read, and drops one nothing touched', async () => {
    const file = await path();

    const first = await openParseCache(file);
    first.set(a, BUTTON);
    first.set(b, TOKENS);
    await first.save();

    const second = await openParseCache(file);
    second.get(a);
    await second.save();

    // Reading counts as using. If it did not, the first run over an unchanged
    // repository would hit every entry and then write a cache with none of them.
    const third = await openParseCache(file);
    expect(third.get(a)).toEqual(BUTTON);
    expect(third.get(b)).toBeUndefined();
  });

  it('keeps an entry a reused record spared it from answering', async () => {
    const file = await path();

    const first = await openParseCache(file);
    first.set(a, BUTTON);
    await first.save();

    // The scan that reuses a whole record never opens the file and never asks
    // this cache anything. Pruning to what it *answered* would empty the cache
    // on exactly the runs where nothing changed, and leave the next run that has
    // to rebuild records with nothing to rebuild them from.
    const second = await openParseCache(file);
    second.keep(a);
    await second.save();

    expect((await openParseCache(file)).get(a)).toEqual(BUTTON);
  });

  it('discards a file an older shape wrote rather than reading it as this one', async () => {
    const file = await path();
    const stored = encodeSourceIndex({ parses: new Map([[a, BUTTON]]), records: new Map() });
    const length = stored.readUInt32LE(0);
    const header = JSON.parse(stored.toString('utf8', 4, 4 + length).replace(/\0+$/, '')) as {
      version: number;
    };
    const changed = Buffer.from(JSON.stringify({ ...header, version: header.version - 1 }), 'utf8');
    stored.fill(0, 4, 4 + length);
    changed.copy(stored, 4);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, stored);

    // The alternative is reading last year's field names into this year's code,
    // which produces edges nobody can trace back to a file.
    expect((await openParseCache(file)).get(a)).toBeUndefined();
  });

  it('starts empty on a file that is not what it expects', async () => {
    const file = await path();
    await openParseCache(file).then((cache) => cache.save());
    await writeFile(file, 'half an index', 'utf8');

    expect((await openParseCache(file)).get(a)).toBeUndefined();
  });

  it('saves nowhere rather than failing the run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'variance-cache-'));
    made.push(dir);

    const blocked = join(dir, 'file');
    await writeFile(blocked, 'not a directory', 'utf8');

    const cache = await openParseCache(join(blocked, 'parse.bin'));
    cache.set(a, BUTTON);

    // A cache that could break a build would be a new failure mode bought with a
    // saving, and no saving is worth that trade.
    await expect(cache.save()).resolves.toBeUndefined();
  });
});
