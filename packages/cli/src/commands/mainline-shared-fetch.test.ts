import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheRootFor,
  declaredSuites,
  lastFetchedMainline,
  mainlineReadRoot,
  readFetchedMainline,
} from '@variance-authority/sense/test-selection';
import type { Env } from '../share-lines.js';
import { mainlineBase, standOnHanded } from './mainline-base.js';
import { git, gitPublished, publishedAt } from './mainline-fixture.js';

/**
 * Where a fetch keeps the mainline's record when the checkouts of one
 * repository each have a cache of their own, the default: in the primary
 * checkout's, which every checkout's reader asks, so a worktree reads what a
 * sibling fetched, and a removed worktree takes nothing with it. A record a
 * run handed on stays the checkout's own.
 */

const LOCAL: Env = {};
let home: string;

beforeEach(async () => {
  // Real, because git records a worktree's primary checkout by its real path.
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-shared-fetch-')));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

/** Every checkout's cache at the default place, inside it: the suite's runner sets one cache for all. */
function ownCaches(): void {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', undefined);
}

/**
 * The mainline published at `first`, a clone of it that fetched that record,
 * then `next` published, and two worktrees of the clone cut at `next`. Every
 * checkout keeps its cache at the default place, inside itself.
 */
async function laptop() {
  const ci = await gitPublished(home);
  const primary = join(home, 'clone');
  await git(home, 'clone', '--quiet', ci.origin, primary);
  ownCaches();
  const base = (dir: string, options: { readonly fetch?: 'always' } = {}) =>
    mainlineBase(dir, declaredSuites(dir)?.find((one) => one.name === 'unit'), { env: LOCAL, now: Date.now(), ...options });
  expect(await base(primary)).toMatchObject({ commit: ci.first });

  await git(ci.ci, 'commit', '--quiet', '--allow-empty', '-m', 'next');
  await git(ci.ci, 'push', '--quiet', 'origin', 'main');
  const next = await git(ci.ci, 'rev-parse', 'HEAD');
  await publishedAt(home, ci.ci, next);
  ownCaches();
  await git(primary, 'fetch', '--quiet', 'origin');
  const tree = async (name: string) => {
    const dir = join(home, name);
    await git(primary, 'worktree', 'add', '--quiet', '--detach', dir, 'origin/main');
    return dir;
  };
  return { primary, first: ci.first, next, one: await tree('one'), two: await tree('two'), base };
}

describe('a mainline record one worktree fetched', () => {
  it('is read by a sibling worktree that fetched nothing, not the older one the primary checkout fetched', async () => {
    const { primary, next, one, two, base } = await laptop();

    expect(await base(one)).toMatchObject({ commit: next });

    expect(lastFetchedMainline(two, 'unit')).toMatchObject({ commit: next });
    expect(lastFetchedMainline(primary, 'unit')).toMatchObject({ commit: next });
    // Kept once, where every checkout's reader asks.
    expect(existsSync(join(mainlineReadRoot(cacheRootFor(one), 'unit'), next))).toBe(false);
  });

  it('outlives the worktree that fetched it', async () => {
    const { primary, next, one, two, base } = await laptop();
    await base(one);

    await git(primary, 'worktree', 'remove', '--force', one);

    expect(existsSync(one)).toBe(false);
    const read = lastFetchedMainline(two, 'unit');
    expect(read).toMatchObject({ commit: next });
    expect(existsSync(read!.coverage)).toBe(true);
  });

  it('is read whole when two worktrees fetch it at once', async () => {
    const { next, one, two, base } = await laptop();

    const both = await Promise.all([base(one), base(two)]);

    expect(both).toMatchObject([{ commit: next }, { commit: next }]);
    const read = lastFetchedMainline(two, 'unit');
    expect(read).toMatchObject({ commit: next });
    expect(await readFile(read!.coverage)).toEqual(await readFile(both[0]!.coverage!));
  });

  it('is never taken by the prune its fetch runs on the shared cache', async () => {
    const { primary, next, one, two, base } = await laptop();
    const shared = cacheRootFor(primary);
    // The shared cache was last pruned two days ago, so the fetch prunes it.
    const stamp = join(shared, '.pruned');
    await writeFile(stamp, '');
    const old = (Date.now() - 2 * 24 * 60 * 60_000) / 1000;
    await utimes(stamp, old, old);

    await base(one);

    expect((await stat(stamp)).mtimeMs).toBeGreaterThan(old * 1000);
    expect(readFetchedMainline(mainlineReadRoot(shared, 'unit'))).toMatchObject({ commit: next });
    expect(lastFetchedMainline(two, 'unit')).toMatchObject({ commit: next });
  });
});

describe('a mainline record a run handed on to a worktree', () => {
  it('is that worktree\'s alone, and a fetch there stays in its own cache', async () => {
    const { first, next, one, two, base } = await laptop();
    const primaryPointer = readFetchedMainline(mainlineReadRoot(cacheRootFor(join(home, 'clone')), 'unit'))!;
    // The record at `first`, laid in `one`'s own read root and marked handed, as `carry receive` leaves it.
    const own = mainlineReadRoot(cacheRootFor(one), 'unit');
    const shared = mainlineReadRoot(cacheRootFor(join(home, 'clone')), 'unit');
    await cp(join(shared, first), join(own, first), { recursive: true });
    await standOnHanded(one, 'unit', { ...primaryPointer, fetched: new Date().toISOString() }, 'not handed');

    expect(lastFetchedMainline(one, 'unit')).toMatchObject({ commit: first, handed: true });
    expect(await base(one, { fetch: 'always' })).toMatchObject({ commit: next });

    expect(existsSync(join(own, next))).toBe(true);
    expect(readFetchedMainline(shared)).toEqual(primaryPointer);
    expect(lastFetchedMainline(two, 'unit')).toMatchObject({ commit: first, fetched: primaryPointer.fetched });
  });
});
