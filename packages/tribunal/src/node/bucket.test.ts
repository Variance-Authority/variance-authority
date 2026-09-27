import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FoldedKey } from '../worker-http.js';
import { createDirectoryBucket, type DirectoryBucket } from './bucket.js';

/**
 * The four methods, and the two things a directory can do that a bucket cannot:
 * resolve a path out of its own tree, and fold two names into one file.
 */

const KEY = 'todomvc/baselines/abc123/story%3Acard.png';

let directory: string;
let bucket: DirectoryBucket;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tribunal-bucket-'));
  bucket = createDirectoryBucket(join(directory, 'objects'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function bytes(...values: readonly number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

describe('an object goes in and comes back', () => {
  it('round-trips bytes under a key with slashes in it', async () => {
    await bucket.put(KEY, bytes(1, 2, 3));

    const object = await bucket.get(KEY);
    expect(object).not.toBeNull();
    expect([...new Uint8Array(await object!.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('makes the directories the key names', async () => {
    await bucket.put(KEY, bytes(1));

    expect(await readdir(join(bucket.root, 'todomvc', 'baselines', 'abc123'))).toEqual([
      'story%3Acard.png',
    ]);
  });

  it('answers null for an object nobody wrote, and for a prefix that is a file', async () => {
    expect(await bucket.get(KEY)).toBeNull();
    expect(await bucket.head(KEY)).toBeNull();

    // A key whose parent is a file rather than a directory: ENOTDIR, which is
    // still "there is no such object" and must not surface as a store failure.
    await bucket.put('todomvc/one.png', bytes(1));
    expect(await bucket.get('todomvc/one.png/two.png')).toBeNull();
  });

  it('heads without reading the bytes', async () => {
    await bucket.put(KEY, bytes(1, 2, 3, 4));

    expect(await bucket.head(KEY)).toEqual({ key: KEY, size: 4 });
  });

  it('deletes one key and many', async () => {
    await bucket.put(KEY, bytes(1));
    await bucket.put('todomvc/builds/b1/story%3Acard-after.png', bytes(2));

    await bucket.delete(KEY);
    expect(await bucket.head(KEY)).toBeNull();

    await bucket.delete([KEY, 'todomvc/builds/b1/story%3Acard-after.png']);
    // Deleting an absent key is not an error — R2 answers the same, and a sweep
    // that removed an object twice would otherwise fail on the second pass.
    expect(await bucket.head('todomvc/builds/b1/story%3Acard-after.png')).toBeNull();
  });

  it('replaces the bytes of a key written twice', async () => {
    await bucket.put(KEY, bytes(1));
    await bucket.put(KEY, bytes(9, 9));

    const object = await bucket.get(KEY);
    expect([...new Uint8Array(await object!.arrayBuffer())]).toEqual([9, 9]);
  });

  it('leaves no staging file behind', async () => {
    await bucket.put(KEY, bytes(1));

    const entries = await readdir(join(bucket.root, 'todomvc', 'baselines', 'abc123'));
    // The write lands beside the target and is renamed onto it. A `.part` still
    // there is a half-written baseline that `find` would return as a truncated PNG.
    expect(entries.filter((entry) => entry.endsWith('.part'))).toEqual([]);
  });
});

describe('a key is not a path until it has been checked', () => {
  it.each([
    ['..', 'a/../../etc/passwd'],
    ['a lone dot', 'a/./b.png'],
    ['a doubled slash', 'a//b.png'],
    ['a backslash', 'a\\b.png'],
    ['a NUL', 'a/b\0.png'],
  ])('refuses %s', async (_why, key) => {
    await expect(bucket.put(key, bytes(1))).rejects.toThrow(/not a file name/);
  });

  it('refuses an absolute key and an empty one', async () => {
    await expect(bucket.get('/etc/passwd')).rejects.toThrow(/not a relative key/);
    await expect(bucket.get('')).rejects.toThrow(/not a relative key/);
  });

  it('refuses to read through a symlink that points out of the tree', async () => {
    const outside = join(directory, 'outside.txt');
    await writeFile(outside, 'secret');

    const { mkdir, symlink } = await import('node:fs/promises');
    await mkdir(join(bucket.root, 'todomvc'), { recursive: true });
    await symlink(outside, join(bucket.root, 'todomvc', 'link.png'));

    // The link resolves inside the tree by name, so the segment check passes and
    // the file is readable. That is the honest state of affairs: a symlink an
    // operator planted in their own object directory is their decision, and the
    // segment check is about keys, not about the directory's contents.
    const object = await bucket.get('todomvc/link.png');
    expect(new TextDecoder().decode(await object!.arrayBuffer())).toBe('secret');
  });
});

describe('two names one volume folds into one file', () => {
  /**
   * Whether the temporary directory's volume treats two spellings as one name.
   * Asked of the volume, so every test below asserts what is true on it: a
   * case-sensitive volume keeps two keys apart and must go on doing so, and a
   * folding one must refuse or miss rather than answer another key's object.
   */
  async function volumeFolds(): Promise<boolean> {
    await writeFile(join(directory, 'Probe'), '');
    return (await stat(join(directory, 'pROBE')).catch(() => null)) !== null;
  }

  const read = async (key: string): Promise<number[] | null> => {
    const object = await bucket.get(key);
    return object === null ? null : [...new Uint8Array(await object.arrayBuffer())];
  };

  it('refuses a write that would land on another key\'s object', async () => {
    await bucket.put('p/baselines/d/Card.png', bytes(1));

    if (!(await volumeFolds())) {
      await bucket.put('p/baselines/d/card.png', bytes(2));
      expect((await readdir(join(bucket.root, 'p', 'baselines', 'd'))).sort()).toEqual(['Card.png', 'card.png']);
      return;
    }
    await expect(bucket.put('p/baselines/d/card.png', bytes(2))).rejects.toThrow(/only by case/);
    expect([...new Uint8Array(await readFile(join(bucket.root, 'p/baselines/d/Card.png')))]).toEqual([1]);
  });

  it('still allows a key to be rewritten under its own name', async () => {
    await bucket.put('p/baselines/d/Card.png', bytes(1));
    await expect(bucket.put('p/baselines/d/Card.png', bytes(2))).resolves.toBeDefined();
  });

  it('keeps two lines whose branches differ only by case apart, or refuses the second', async () => {
    const upper = 'p/share/branch/Feature/manifest.json';
    const lower = 'p/share/branch/feature/manifest.json';
    await bucket.put(upper, bytes(1), { onlyIf: { etagDoesNotMatch: '*' } });

    if (!(await volumeFolds())) {
      expect(await bucket.put(lower, bytes(2), { onlyIf: { etagDoesNotMatch: '*' } })).not.toBeNull();
      expect([await read(upper), await read(lower)]).toEqual([[1], [2]]);
      return;
    }
    // Refused, not answered as a conflict: the stored manifest is another line's,
    // and a retry on its version would replace it.
    await expect(bucket.put(lower, bytes(2), { onlyIf: { etagDoesNotMatch: '*' } })).rejects.toThrow(/"feature"/);
    await expect(bucket.put(lower, bytes(2))).rejects.toThrow(/only by case/);
    // A file the other line never wrote, under the folded directory, is refused too.
    await expect(bucket.put('p/share/branch/feature/entries/0a', bytes(3))).rejects.toThrow(/only by case/);
    expect(await read(upper)).toEqual([1]);
  });

  it('lets one of two lines created at once by spellings that fold take the directory, and refuses the other', async () => {
    const upper = 'p/share/branch/Feature/manifest.json';
    const lower = 'p/share/branch/feature/manifest.json';
    const [first, second] = await Promise.allSettled([
      bucket.put(upper, bytes(1), { onlyIf: { etagDoesNotMatch: '*' } }),
      bucket.put(lower, bytes(2), { onlyIf: { etagDoesNotMatch: '*' } }),
    ]);

    if (!(await volumeFolds())) {
      expect([first.status, second.status]).toEqual(['fulfilled', 'fulfilled']);
      expect([await read(upper), await read(lower)]).toEqual([[1], [2]]);
      return;
    }
    const held = await readdir(join(bucket.root, 'p', 'share', 'branch'));
    expect(held).toHaveLength(1);
    const [won, lost, winner] = held[0] === 'Feature' ? [first, second, upper] : [second, first, lower];
    expect(won.status).toBe('fulfilled');
    expect(lost.status).toBe('rejected');
    const reason = (lost as PromiseRejectedResult).reason as Error;
    // A folded key is its own class, which the worker answers 422 rather than 500.
    expect(reason).toBeInstanceOf(FoldedKey);
    expect(reason.message).toMatch(/only by case/);
    // The message goes back to whoever sent the key, so it names the key's directory, not this machine's.
    expect(reason.message).not.toContain(directory);
    expect(await read(winner)).toEqual(winner === upper ? [1] : [2]);
  });

  it('answers nothing for a key that reaches an object only through another spelling', async () => {
    const upper = 'p/share/branch/Feature/manifest.json';
    const lower = 'p/share/branch/feature/manifest.json';
    await bucket.put(upper, bytes(1));

    // On either volume, the lower-case line was never written.
    expect(await read(lower)).toBeNull();
    expect(await bucket.head(lower)).toBeNull();
    await bucket.delete(lower);
    expect(await read(upper)).toEqual([1]);
    expect(await bucket.head(upper)).toEqual({ key: upper, size: 1 });
  });
});

describe('a manifest is replaced only on the version it was read at', () => {
  const MANIFEST = 'todomvc/share/mainline/main/manifest.json';

  it('writes a new key once under `etagDoesNotMatch: *`, and refuses the second writer', async () => {
    const first = await bucket.put(MANIFEST, bytes(1), { onlyIf: { etagDoesNotMatch: '*' } });
    const second = await bucket.put(MANIFEST, bytes(2), { onlyIf: { etagDoesNotMatch: '*' } });

    expect(first?.httpEtag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(second).toBeNull();
    expect([...new Uint8Array(await (await bucket.get(MANIFEST))!.arrayBuffer())]).toEqual([1]);
  });

  it('replaces on the version it was given, and refuses a version that has moved on', async () => {
    const written = await bucket.put(MANIFEST, bytes(1));
    const version = written!.httpEtag.slice(1, -1);
    expect((await bucket.get(MANIFEST))?.httpEtag).toBe(written?.httpEtag);

    const replaced = await bucket.put(MANIFEST, bytes(2), { onlyIf: { etagMatches: version } });
    expect(replaced?.httpEtag).not.toBe(written?.httpEtag);
    expect(await bucket.put(MANIFEST, bytes(3), { onlyIf: { etagMatches: version } })).toBeNull();
  });

  it('lets exactly one of two writers racing on one version win', async () => {
    const version = (await bucket.put(MANIFEST, bytes(1)))!.httpEtag.slice(1, -1);

    const results = await Promise.all([
      bucket.put(MANIFEST, bytes(2), { onlyIf: { etagMatches: version } }),
      bucket.put(MANIFEST, bytes(3), { onlyIf: { etagMatches: version } }),
    ]);
    expect(results.filter((result) => result === null)).toHaveLength(1);
  });
});
