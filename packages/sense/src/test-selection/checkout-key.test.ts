import { mkdir, mkdtemp, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { CHECKOUT_MARKER, cacheLayers, markCheckout, readCheckoutMarker } from './cache-layers.js';

/** A directory holding a primary checkout, `primary`, whose git directory lists one worktree. */
async function checkout(): Promise<string> {
  const at = await mkdtemp(resolve(tmpdir(), 'va-key-'));
  await mkdir(resolve(at, 'primary', '.git', 'worktrees', 'feature'), { recursive: true });

  return at;
}

/** A worktree at `path`, cut from the checkout at `primary`. */
async function worktree(path: string, primary: string): Promise<string> {
  await mkdir(path, { recursive: true });
  await writeFile(resolve(path, '.git'), `gitdir: ${resolve(primary, '.git', 'worktrees', basename(path))}\n`);

  return path;
}

describe('the key a checkout is kept under', () => {
  test('a checkout renamed with its cache inside it keeps its layer, and its worktree the base it reads', async () => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', '');
    const at = await realpath(await checkout());
    const before = cacheLayers(resolve(at, 'primary'));
    const moved = `${at}-moved`;
    await rename(at, moved);

    const after = cacheLayers(resolve(moved, 'primary'));
    const feature = cacheLayers(await worktree(resolve(moved, 'feature'), resolve(moved, 'primary')));
    vi.unstubAllEnvs();

    expect(relative(moved, after.top)).toBe(relative(at, before.top));
    expect(feature.base).toBe(after.top);
  });

  test('two worktrees whose `node_modules` is a link to the primary checkout\'s keep two layers there', async () => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', '');
    const primary = resolve(await checkout(), 'primary');
    await mkdir(resolve(primary, 'node_modules'));
    const tops = [];
    for (const name of ['a', 'b']) {
      const path = await worktree(resolve(primary, '.wt', name), primary);
      await symlink(resolve(primary, 'node_modules'), resolve(path, 'node_modules'));
      const { top } = cacheLayers(path);
      await mkdir(top, { recursive: true });
      tops.push(await realpath(top));
    }
    vi.unstubAllEnvs();

    expect(tops[0]).not.toBe(tops[1]);
  });

  test('a cache directory reached through a link is the directory it links to', async () => {
    const at = await checkout();
    await mkdir(resolve(at, 'cache'));
    await mkdir(resolve(at, 'elsewhere'));
    await symlink(resolve(at, 'cache'), resolve(at, 'elsewhere', 'link'));

    expect(basename(cacheLayers(resolve(at, 'primary'), resolve(at, 'elsewhere', 'link')).top))
      .toBe(basename(cacheLayers(resolve(at, 'primary'), resolve(at, 'cache')).top));
  });

  test('two checkouts that share one cache directory keep two layers in it', async () => {
    const at = await checkout();

    expect(cacheLayers(resolve(at, 'primary'), resolve(at, 'cache')).top)
      .not.toBe(cacheLayers(resolve(at, 'copy'), resolve(at, 'cache')).top);
  });

  test('the marker a checkout writes names it from the cache directory', async () => {
    const at = await checkout();
    const primary = resolve(at, 'primary');
    const cache = resolve(primary, 'node_modules', '.cache');

    markCheckout(primary, cache);

    expect(JSON.parse(await readFile(resolve(cacheLayers(primary, cache).top, CHECKOUT_MARKER), 'utf8')))
      .toEqual({ checkout: join('..', '..'), primary: join('..', '..') });
    const physical = await realpath(primary);
    expect(readCheckoutMarker(cacheLayers(primary, cache).top, cache)).toEqual({ checkout: physical, primary: physical });
  });
});
