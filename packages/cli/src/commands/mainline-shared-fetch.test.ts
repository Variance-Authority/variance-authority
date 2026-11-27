import { existsSync } from 'node:fs';
import { chmod, cp, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheRootFor,
  declaredSuites,
  lastFetchedMainline,
  mainlineReadRoot,
  readFetchedMainline,
  SHARED_MAINLINE,
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
  const tree = async (name: string, at = 'origin/main') => {
    const dir = join(home, name);
    await git(primary, 'worktree', 'add', '--quiet', '--detach', dir, at);
    return dir;
  };
  return { primary, first: ci.first, next, one: await tree('one'), two: await tree('two'), tree, base };
}

describe('a mainline record one worktree fetched', () => {
  it('is read by a sibling worktree that fetched nothing, not the older one the primary checkout fetched', async () => {
    const { primary, first, next, one, two, base } = await laptop();

    expect(await base(one)).toMatchObject({ commit: next });

    expect(lastFetchedMainline(two, 'unit')).toMatchObject({ commit: next });
    // The primary checkout fetched, so it stands on its own until it fetches again.
    expect(lastFetchedMainline(primary, 'unit')).toMatchObject({ commit: first });
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

  it('prunes the mainline records of the shared cache, and nothing else the primary checkout keeps', async () => {
    const { primary, next, one, two, base } = await laptop();
    const shared = cacheRootFor(primary);
    const reads = mainlineReadRoot(shared, 'unit');
    const month = (Date.now() - 30 * 24 * 60 * 60_000) / 1000;
    // A record of a commit no checkout holds, a month old, which the prune takes.
    const gone = join(reads, 'f'.repeat(40));
    await cp(join(reads, readFetchedMainline(reads)!.commit), gone, { recursive: true });
    await utimes(gone, month, month);
    // A newer one, which the prune keeps as the newest no pointer names.
    const newest = join(reads, 'e'.repeat(40));
    await cp(gone, newest, { recursive: true });
    // The primary's own whole prune ran two days ago, and is its own to run again.
    const whole = join(shared, '.pruned');
    await writeFile(whole, '');
    const old = (Date.now() - 2 * 24 * 60 * 60_000) / 1000;
    await utimes(whole, old, old);

    await base(one);

    expect(existsSync(gone)).toBe(false);
    expect(existsSync(newest)).toBe(true);
    expect((await stat(whole)).mtimeMs).toBe(old * 1000);
    expect(readFetchedMainline(reads, SHARED_MAINLINE)).toMatchObject({ commit: next });
    expect(lastFetchedMainline(two, 'unit')).toMatchObject({ commit: next });
  });

  it('is read at a worktree\'s merge base after a sibling at another merge base fetched, without asking the line', async () => {
    const { first, next, one, tree, base } = await laptop();
    const behind = await tree('behind', `${next}~1`);
    expect(await base(behind)).toMatchObject({ commit: first });
    expect(await base(one)).toMatchObject({ commit: next });

    await git(behind, 'remote', 'set-url', 'origin', join(home, 'nowhere.git'));

    expect(await base(behind)).toMatchObject({ commit: first, distance: 0 });
    // The runner seams lay what the share reads.
    expect(lastFetchedMainline(behind, 'unit')).toMatchObject({ commit: first });
  });

  it('is not taken from a fresh worktree by a later fetch at an older merge base', async () => {
    const { primary, first, next, one, tree, base } = await laptop();
    expect(await base(one)).toMatchObject({ commit: next });
    // The record at `first` is no longer kept, so the worktree behind fetches it again.
    await rm(join(mainlineReadRoot(cacheRootFor(primary), 'unit'), first), { recursive: true, force: true });
    const behind = await tree('behind', `${next}~1`);

    expect(await base(behind)).toMatchObject({ commit: first });

    expect(lastFetchedMainline(behind, 'unit')).toMatchObject({ commit: first });
    expect(lastFetchedMainline(await tree('fresh'), 'unit')).toMatchObject({ commit: next });
  });

  it('is never written over by another checkout\'s fetch of the same commit, which keeps its copy in its own cache', async () => {
    const { primary, first, next, one, two, base } = await laptop();
    expect(await base(one)).toMatchObject({ commit: next });
    const reads = mainlineReadRoot(cacheRootFor(primary), 'unit');
    const shared = join(reads, next, 'coverage.bin');
    // Bytes another build kept: not the ones this build would write.
    await cp(join(reads, first, 'coverage.bin'), shared);
    const before = await readFile(shared);

    expect(await base(two, { fetch: 'always' })).toMatchObject({ commit: next });

    expect(await readFile(shared)).toEqual(before);
    const own = join(mainlineReadRoot(cacheRootFor(two), 'unit'), next, 'coverage.bin');
    expect(existsSync(own)).toBe(true);
    // What the fetch kept is what the runner seams read, not the other build's bytes.
    expect(lastFetchedMainline(two, 'unit')).toMatchObject({ commit: next, coverage: own });
  });

  it('is not taken from a fresh worktree when the primary checkout fetches at its older merge base', async () => {
    const { primary, first, next, one, tree, base } = await laptop();
    expect(await base(one)).toMatchObject({ commit: next });

    expect(await base(primary, { fetch: 'always' })).toMatchObject({ commit: first });

    expect(lastFetchedMainline(primary, 'unit')).toMatchObject({ commit: first });
    expect(lastFetchedMainline(await tree('fresh'), 'unit')).toMatchObject({ commit: next });
  });

  it('keeps it in its own when it cannot write the primary checkout\'s', async () => {
    const { primary, first, next, one, base } = await laptop();
    const shared = mainlineReadRoot(cacheRootFor(primary), 'unit');
    // A sandbox that lets the worktree write only inside itself.
    await chmod(shared, 0o555);
    try {
      expect(await base(one)).toMatchObject({ commit: next });
    } finally {
      await chmod(shared, 0o755);
    }

    expect(existsSync(join(mainlineReadRoot(cacheRootFor(one), 'unit'), next, 'coverage.bin'))).toBe(true);
    expect(lastFetchedMainline(one, 'unit')).toMatchObject({ commit: next });
    expect(readFetchedMainline(shared)).toMatchObject({ commit: first });
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
