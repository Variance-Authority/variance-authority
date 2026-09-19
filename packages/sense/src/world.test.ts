import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repoPathOf, worldIn, worldOn } from './world.js';

/**
 * The three questions every language but JavaScript resolves by asking.
 *
 * They have to answer identically whether the world was handed the paths a scan
 * walked or walked a directory itself, because a resolution that depends on
 * which one the caller built is a resolution that changes between a scan and a
 * test of that scan.
 */

describe('the tree, as a resolver sees it', () => {
  const paths = [
    'a/b.java',
    'a/b/c.java',
    'a/b/deep/d.java',
    'ab/e.java',
    'z.java',
  ];

  it('tells what is directly inside a directory from what is anywhere below it', () => {
    const world = worldIn(paths);

    // A Java package is a directory, not a subtree; a Swift target is a subtree.
    expect(world.under('a/b')).toEqual(['a/b/c.java']);
    expect(world.below('a/b')).toEqual(['a/b/c.java', 'a/b/deep/d.java']);
  });

  it('does not let a directory reach a sibling whose name it prefixes', () => {
    // `ab` sorts between `a/…` entries and would fall inside a plain prefix
    // scan of `a`.
    expect(worldIn(paths).below('a')).toEqual(['a/b.java', 'a/b/c.java', 'a/b/deep/d.java']);
  });

  it('answers for the root as the whole tree', () => {
    expect(worldIn(paths).below('')).toEqual(paths);
    expect(worldIn(paths).under('')).toEqual(['z.java']);
  });

  it('computes an index once and hands back the same one', () => {
    const world = worldIn(paths);
    let built = 0;
    const count = (): number => world.index('probe', () => (built += 1));

    expect(count()).toBe(1);
    expect(count()).toBe(1);
    expect(built).toBe(1);
  });

  it('has no text for a world built from paths alone', () => {
    expect(worldIn(paths).text('a/b.java')).toBeUndefined();
  });
});

describe('a world over a directory', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-world-'));
    await write(root, 'Cargo.toml', '[package]\nname = "held"\n');
    await write(root, 'src/lib.rs', '');
    await write(root, 'node_modules/dep/index.js', '');
    await write(root, '.hidden/secret.rs', '');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('walks the tree the scan would, and skips what a scan skips', () => {
    const world = worldOn(root);

    expect(world.below('')).toEqual(['Cargo.toml', 'src/lib.rs']);
    expect(world.has('src/lib.rs')).toBe(true);
    expect(world.has('node_modules/dep/index.js')).toBe(false);
  });

  it('reads the one thing a path cannot say: what a manifest holds', () => {
    expect(worldOn(root).text('Cargo.toml')).toContain('name = "held"');
    expect(worldOn(root).text('nothing.toml')).toBeUndefined();
  });

  it('spells an absolute path the way the tree is keyed', () => {
    expect(repoPathOf(root, join(root, 'src', 'lib.rs'))).toBe('src/lib.rs');
  });
});

async function write(root: string, path: string, contents: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}
