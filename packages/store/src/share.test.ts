import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firstShared, shareKey } from '@variance-authority/core/share';
import { createDirectoryShare } from './share.js';

/**
 * The directory a share is, and the three ways a caller could be hurt by one:
 * a key that escapes it, a read of something that was never written, and a
 * partially written file that a reader would otherwise believe.
 */
describe('createDirectoryShare', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'va-share-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const bytes = new Uint8Array([1, 2, 3, 4]);

  it('round-trips through nested directories nobody created', async () => {
    const cache = createDirectoryShare(root);
    const key = shareKey({ project: 'shop', artifact: 'suite-index-v1', commit: '9f1c0b3a' });

    await cache.put(key, bytes);

    expect(await cache.get(key)).toEqual(bytes);
  });

  it('answers null for a key nobody wrote', async () => {
    expect(await createDirectoryShare(root).get('shop/a/none.bin')).toBeNull();
  });

  it('answers null for a root that does not exist, rather than making one', async () => {
    const missing = join(root, 'never', 'made');
    expect(await createDirectoryShare(missing).get('a/b.bin')).toBeNull();
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('leaves nothing behind when a write finishes', async () => {
    const cache = createDirectoryShare(root);
    await cache.put('shop/a/c.bin', bytes);

    expect(await readdir(join(root, 'shop', 'a'))).toEqual(['c.bin']);
  });

  it('overwrites a key with a later publication', async () => {
    const cache = createDirectoryShare(root);
    await cache.put('shop/a/c.bin', bytes);
    await cache.put('shop/a/c.bin', new Uint8Array([9]));

    expect(await cache.get('shop/a/c.bin')).toEqual(new Uint8Array([9]));
  });

  it('refuses a key that would leave the root, as a miss', async () => {
    const cache = createDirectoryShare(join(root, 'inside'));
    await writeFile(join(root, 'outside.bin'), bytes);

    expect(await cache.get('../outside.bin')).toBeNull();
    await expect(cache.put('../written.bin', bytes)).resolves.toBeUndefined();
    expect(await readdir(root)).toEqual(['outside.bin']);
  });

  it('is what a lineage lookup walks', async () => {
    const cache = createDirectoryShare(root);
    const of = (commit: string): string =>
      shareKey({ project: 'shop', artifact: 'suite-index-v1', commit });
    await cache.put(of('older'), bytes);

    const hit = await firstShared(cache, ['head', 'nearer', 'older'], of);

    expect(hit?.commit).toBe('older');
    expect(hit?.behind).toBe(2);
    expect(hit?.bytes).toEqual(bytes);
  });
});
