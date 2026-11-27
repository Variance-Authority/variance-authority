import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readdir, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheRootFor,
  declaredSuites,
  lastFetchedMainline,
  mainlineReadRoot,
  pinnedMainlines,
  readFetchedMainline,
  writeTestCoverage,
} from '@variance-authority/sense/test-selection';
import type { Env } from '../share-lines.js';
import { handBase } from './carry-handed.js';
import { mainlineBase, standOnHanded } from './mainline-base.js';
import { DISCOUNTS, git, gitPublished, published, publishedAt, publishTo, PUSH, recordIn, totalCoverage, totalModule } from './mainline-fixture.js';
import { checkoutOwners, planCachePrune } from './prune-cache.js';
import { publishedPartialNext, publishedWhole } from './milestone-pin.fixture.js';

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
    // The primary checkout's HEAD is still at the commit it fetched, so it reads that one.
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
    // A newer one, which the prune keeps as the newest no checkout reads.
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
    expect(existsSync(join(reads, next))).toBe(true);
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
    // Its record lives in the shared cache alone, so a prune there keeps it.
    expect(await pinnedMainlines(one)).toEqual(expect.arrayContaining([first, next]));
  });

  it('is not read by a worktree whose HEAD it is ahead of, which reads the nearest kept record behind it', async () => {
    const { first, next, one, tree, base } = await laptop();
    expect(await base(one)).toMatchObject({ commit: next });

    const behind = await tree('behind', first);

    expect(lastFetchedMainline(behind, 'unit')).toMatchObject({ commit: first });
  });

  it('is read by a worktree whose HEAD moved past it, with no share run', async () => {
    const { first, next, one, tree, base } = await laptop();
    const behind = await tree('behind', first);
    expect(await base(behind)).toMatchObject({ commit: first });
    expect(await base(one)).toMatchObject({ commit: next });

    await git(behind, 'checkout', '--quiet', '--detach', next);

    expect(lastFetchedMainline(behind, 'unit')).toMatchObject({ commit: next });
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

  it('is not taken from a fresh worktree when the primary checkout fetches at its older merge base', async () => {
    const { primary, first, next, one, tree, base } = await laptop();
    expect(await base(one)).toMatchObject({ commit: next });

    expect(await base(primary, { fetch: 'always' })).toMatchObject({ commit: first });

    expect(lastFetchedMainline(primary, 'unit')).toMatchObject({ commit: first });
    expect(lastFetchedMainline(await tree('fresh'), 'unit')).toMatchObject({ commit: next });
  });

  it('is kept by a prune the primary checkout runs, while a worktree reads it', async () => {
    const { primary, first, next, one, tree, base } = await laptop();
    const behind = await tree('behind', first);
    expect(await base(behind)).toMatchObject({ commit: first });
    expect(await base(one)).toMatchObject({ commit: next });
    const reads = mainlineReadRoot(cacheRootFor(primary), 'unit');
    // A newer record no checkout reads, so `first` is not the newest the prune keeps anyway.
    await cp(join(reads, first), join(reads, 'e'.repeat(40)), { recursive: true });
    const week = (Date.now() - 7 * 24 * 60 * 60_000) / 1000;
    await utimes(join(reads, first), week, week);

    // Every kept commit falls far behind the primary's HEAD, as on a busy mainline.
    const plan = await planCachePrune({ cacheRoot: cacheRootFor(primary) }, { ...checkoutOwners(primary), past: async () => 500 });

    expect(plan.remove.map((entry) => entry.path)).not.toContain(join(reads, first));
  });

  it('keeps it in its own when it cannot write the primary checkout\'s', async () => {
    const { primary, first, next, one, base } = await laptop();
    const shared = mainlineReadRoot(cacheRootFor(primary), 'unit');
    // A primary's cache the worktree cannot write the record into, whoever runs it: root ignores a mode.
    await writeFile(join(shared, next), '');

    expect(await base(one)).toMatchObject({ commit: next });

    expect(existsSync(join(mainlineReadRoot(cacheRootFor(one), 'unit'), next, 'coverage.bin'))).toBe(true);
    expect(lastFetchedMainline(one, 'unit')).toMatchObject({ commit: next });
    expect(readFetchedMainline(shared)).toMatchObject({ commit: first });
  });
});

describe('a partial mainline record the primary checkout fetched', () => {
  it('is replaced by the whole one published later at the same commit', async () => {
    const { ci, origin, first } = await gitPublished(home);
    const primary = join(home, 'clone');
    await git(home, 'clone', '--quiet', origin, primary);
    ownCaches();
    const next = await publishedPartialNext(home, ci, first);
    await git(primary, 'pull', '--quiet', 'origin', 'main');
    const base = () => mainlineBase(primary, declaredSuites(primary)?.find((one) => one.name === 'unit'), { env: LOCAL, now: Date.now(), fetch: 'always' });
    expect(await base()).toMatchObject({ commit: next });
    expect(lastFetchedMainline(primary, 'unit')).toMatchObject({ commit: next, partial: true });
    const partial = await readFile(lastFetchedMainline(primary, 'unit')!.coverage);
    // The whole run entered the module from one test file, not two.
    const one = ['test/total.test.ts'];
    await publishedWhole(home, ci, next, (record) => writeTestCoverage(record, totalCoverage(next, one, [totalModule(one)])));
    ownCaches();
    // The line was read a moment ago: age that read, so the fetch asks it again.
    const cache = cacheRootFor(primary);
    for (const path of (await readdir(cache, { recursive: true })).filter((one) => one.includes('variance-fetched'))) await utimes(join(cache, path), 0, 0);

    expect(await base()).toMatchObject({ commit: next });

    const read = lastFetchedMainline(primary, 'unit');
    expect(read?.partial).toBeUndefined();
    expect(await readFile(read!.coverage)).not.toEqual(partial);
    expect(JSON.parse(await readFile(read!.runs!, 'utf8'))).toMatchObject({ standing: [] });
  });
});

describe('a mainline record a run handed on to the primary checkout', () => {
  it('is no sibling worktree\'s read, and stays the primary\'s after a sibling fetches', async () => {
    const { primary, first, next, one, tree, base } = await laptop();
    const pointer = readFetchedMainline(mainlineReadRoot(cacheRootFor(primary), 'unit'))!;
    const behind = await tree('behind', first);

    await standOnHanded(primary, 'unit', { ...pointer, fetched: new Date().toISOString() }, 'not handed');
    expect(await base(one)).toMatchObject({ commit: next });

    expect(lastFetchedMainline(primary, 'unit')).toMatchObject({ commit: first, handed: true });
    const read = lastFetchedMainline(behind, 'unit');
    expect(read).toMatchObject({ commit: first });
    expect(read?.handed).toBeUndefined();
  });
});

describe('a mainline record a sibling fetches at the commit a run handed the primary checkout', () => {
  it('is kept in the sibling\'s own cache, and the bytes the primary checkout stands on stay', async () => {
    const { primary, first, tree, base } = await laptop();
    const shared = mainlineReadRoot(cacheRootFor(primary), 'unit');
    const pointer = readFetchedMainline(shared)!;
    await standOnHanded(primary, 'unit', { ...pointer, fetched: new Date().toISOString() }, 'not handed');
    const handed = (await stat(join(shared, first, 'coverage.bin'))).mtimeMs;
    const behind = await tree('behind', first);

    const read = await base(behind, { fetch: 'always' });

    expect(read).toMatchObject({ commit: first });
    expect(read.coverage).toBe(join(mainlineReadRoot(cacheRootFor(behind), 'unit'), first, 'coverage.bin'));
    expect((await stat(join(shared, first, 'coverage.bin'))).mtimeMs).toBe(handed);
  });
});

describe('a read a run hands on from the primary checkout', () => {
  it('leaves every record a sibling worktree reads where it was', async () => {
    const { primary, first, next, one, base } = await laptop();
    await base(one);

    await handBase(primary, join(home, 'hand'), { env: LOCAL, now: Date.now() });

    expect(lastFetchedMainline(primary, 'unit')).toMatchObject({ commit: first, handed: true });
    expect(lastFetchedMainline(one, 'unit')).toMatchObject({ commit: next });
  });

  it('is not what a worktree hands on after it fetches another commit', async () => {
    const { primary, next, one } = await laptop();
    await handBase(primary, join(home, 'hand'), { env: LOCAL, now: Date.now() });

    const handed = await handBase(one, join(home, 'hand-one'), { env: LOCAL, now: Date.now() });

    expect(handed.commits).toEqual([next]);
    expect(readFetchedMainline(join(home, 'hand-one', 'unit'))).toMatchObject({ commit: next });
  });
});

describe('a mainline record a sibling worktree reads under a suite another checkout renamed', () => {
  it('is pinned by that checkout\'s prune', async () => {
    const { next, one, tree, base } = await laptop();
    await base(one);
    const renamed = await tree('renamed');
    await writeFile(join(renamed, 'variance.config.json'), JSON.stringify({ ...JSON.parse(await readFile(join(renamed, 'variance.config.json'), 'utf8')), suites: { renamed: { kind: 'unit', carry: 'share' } } }));

    expect(await pinnedMainlines(renamed)).toContain(next);
  });
});

describe('a mainline record kept more than a walk behind HEAD', () => {
  it('is read when every kept record within the walk does not read, over a newer one HEAD lacks', async () => {
    const { first, next, tree, one, base } = await laptop();
    await base(one);
    const deep = await tree('deep', first);
    // 1001 commits on `first`, so the walk from HEAD stops short of it; dated after it, as git's ancestry walk trusts commit dates.
    const after = Number(await git(deep, 'log', '-1', '--format=%ct', first)) + 1;
    const stream = Array.from({ length: 1001 }, (_, at) =>
      `commit refs/heads/deep\nmark :${at + 1}\ncommitter a <a@example.com> ${after + at} +0000\ndata 0\nfrom ${at === 0 ? first : `:${at}`}\n`).join('');
    execFileSync('git', ['fast-import', '--quiet'], { cwd: deep, input: stream });
    await git(deep, 'checkout', '--quiet', 'deep');
    // A record within the walk that this build does not read: its pointer, without its bytes.
    const near = await git(deep, 'rev-parse', 'HEAD~5');
    const shared = mainlineReadRoot(cacheRootFor(join(home, 'clone')), 'unit');
    await cp(join(shared, first, 'fetched.json'), join(shared, near, 'fetched.json'));
    await writeFile(join(shared, near, 'fetched.json'), JSON.stringify({ ...readFetchedMainline(join(shared, first))!, commit: near }));

    expect(lastFetchedMainline(deep, 'unit')).toMatchObject({ commit: first });
    expect(lastFetchedMainline(one, 'unit')).toMatchObject({ commit: next });
  });

  it('is read nearest first among those past the walk, whichever was fetched last', async () => {
    const { first, tree, base, one } = await laptop();
    await base(one);
    const deep = await tree('deep', first);
    const after = Number(await git(deep, 'log', '-1', '--format=%ct', first)) + 1;
    const stream = Array.from({ length: 1001 }, (_, at) =>
      `commit refs/heads/deep\nmark :${at + 1}\ncommitter a <a@example.com> ${after + at} +0000\ndata 0\nfrom ${at === 0 ? first : `:${at}`}\n`).join('');
    execFileSync('git', ['fast-import', '--quiet'], { cwd: deep, input: stream });
    await git(deep, 'checkout', '--quiet', 'deep');
    // `first`'s bytes kept again at the commit just past the walk, fetched before `first` was, in the cache listed after the shared one.
    const nearer = await git(deep, 'rev-parse', 'HEAD~1000');
    const shared = mainlineReadRoot(cacheRootFor(join(home, 'clone')), 'unit');
    const own = mainlineReadRoot(cacheRootFor(deep), 'unit');
    await cp(join(shared, first), join(own, nearer), { recursive: true });
    await writeFile(join(own, nearer, 'fetched.json'), JSON.stringify({ ...readFetchedMainline(join(shared, first))!, commit: nearer, fetched: '2000-01-01T00:00:00.000Z' }));
    // And a record within the walk that this build does not read: its pointer, without its bytes.
    const near = await git(deep, 'rev-parse', 'HEAD~5');
    await cp(join(shared, first, 'fetched.json'), join(shared, near, 'fetched.json'));
    await writeFile(join(shared, near, 'fetched.json'), JSON.stringify({ ...readFetchedMainline(join(shared, first))!, commit: near }));

    expect(lastFetchedMainline(deep, 'unit')).toMatchObject({ commit: nearer });
  });
});

describe('a mainline record a share that keeps only its latest gave', () => {
  it('is read by a worktree whose merge base it is past, over an older record kept behind it', async () => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
    const ci = await published(home);
    const primary = join(home, 'clone');
    await git(home, 'clone', '--quiet', ci.origin, primary);
    ownCaches();
    const base = (dir: string) => mainlineBase(dir, declaredSuites(dir)?.find((one) => one.name === 'unit'), { env: LOCAL, now: Date.now() });
    expect(await base(primary)).toMatchObject({ commit: ci.first });
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
    await git(ci.dir, 'commit', '--quiet', '--allow-empty', '-m', 'unpublished');
    await git(ci.dir, 'commit', '--quiet', '--allow-empty', '-m', 'latest');
    const latest = await git(ci.dir, 'rev-parse', 'HEAD');
    await git(ci.dir, 'push', '--quiet', 'origin', 'main');
    await recordIn(ci.dir, latest, ['test/total.test.ts'], [DISCOUNTS]);
    await publishTo(home, ci.dir, latest, PUSH, 'mainline main');
    ownCaches();
    await git(primary, 'fetch', '--quiet', 'origin');
    const worktree = async (name: string, at: string) => {
      const dir = join(home, name);
      await git(primary, 'worktree', 'add', '--quiet', '--detach', dir, at);
      return dir;
    };
    const behind = await worktree('behind', 'origin/main~1');

    expect(await base(await worktree('ahead', 'origin/main'))).toMatchObject({ commit: latest });

    // The share holds nothing nearer, so the record past the merge base stands, as it does for the worktree that fetched it.
    expect(lastFetchedMainline(behind, 'unit')).toMatchObject({ commit: latest });
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
