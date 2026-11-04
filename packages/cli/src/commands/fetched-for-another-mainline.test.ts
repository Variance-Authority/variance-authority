import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedPaths } from '@variance-authority/sense';
import { instrumentationId } from '@variance-authority/sense/instrument';
import {
  cacheRootFor,
  type FetchedMainline,
  lastFetchedMainline,
  mainlineReadRoot,
  prepareRecord,
  readOwnLayer,
  testCoverageFile,
  withIndexLock,
  writeFetchedMainline,
  writeTestCoverage,
} from '@variance-authority/sense/test-selection';
import { main } from '../bin.fixture.js';
import { landSuite } from './journeys-command.js';
import { landJourneys } from './land.js';
import { cloneOf, git, published, ranWhole } from './mainline-fixture.js';
import { probesGap } from './probes-gap.js';
import { suiteBase } from './suite-base.js';
import { recordedSuite } from './suite-record.js';

// `ci-info` decides CI once, when it loads, so the module is cut: these questions are asked outside CI.
vi.mock('ci-info', () => ({ isCI: false }));

/**
 * A pointer left by a fetch for `release`, in a clone whose mainline is `main`
 * and whose share holds nothing for `main`. The record it names answers nothing
 * about this checkout, so no path reads it, lays it or offers it.
 */

const PROBES = instrumentationId('presence');

let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-another-mainline-')));
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

/** The clone, with `release`'s record fetched into its cache, and this checkout's own path still empty. */
async function fetchedForRelease() {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
  const { dir, origin, first } = await published(home, { publish: false });
  const recorded = testCoverageFile(dir, { suite: 'unit' });
  await ranWhole(recorded, first);
  const clone = await cloneOf(home, origin);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'clone-cache'));
  const kept = await fetchedInto(clone, recorded, { mainline: 'release', commit: first, fetched: new Date().toISOString() });
  process.chdir(clone);
  return { clone, first, kept, recorded, own: testCoverageFile(clone, { suite: 'unit' }) };
}

/** Keep `recorded` in `checkout`'s cache, as a fetch of `pointer` would, and say where. */
async function fetchedInto(checkout: string, recorded: string, pointer: FetchedMainline): Promise<string> {
  const cache = cacheRootFor(checkout);
  const kept = join(mainlineReadRoot(cache, 'unit'), pointer.commit, 'coverage.bin');
  await mkdir(dirname(kept), { recursive: true });
  await copyFile(recorded, kept);
  await writeFetchedMainline(cache, 'unit', pointer);
  return kept;
}

/** A shard one run at `commit` left, to land. */
async function shardAt(commit: string): Promise<string> {
  const shard = join(home, 'shard.bin');
  await writeTestCoverage(shard, {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
    modules: [],
  });
  return shard;
}

const ask = async (argv: readonly string[]) => {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
};

describe('a first run', () => {
  it('lays nothing of the other mainline through `variance journeys`, which selects before it lands', async () => {
    const { first, own } = await fetchedForRelease();

    const landed = await ask(['journeys', await shardAt(first), '--suite', 'unit']);

    expect(landed.err).not.toContain('release');
    expect((await readOwnLayer(own))?.pinned).toBeUndefined();
  });

  it('lays nothing of it through a landing `into` this checkout\'s own record', async () => {
    const { clone, first, own } = await fetchedForRelease();

    await landJourneys(clone, [await shardAt(first)], own);

    expect((await readOwnLayer(own))?.pinned).toBeUndefined();
  });

  it('lays nothing of it through a fan-in that lands a suite', async () => {
    const { clone, first, own } = await fetchedForRelease();

    await landSuite(clone, [await shardAt(first)], 'unit');

    expect((await readOwnLayer(own))?.pinned).toBeUndefined();
  });

  it('lands `--into` a file outside the cache whatever the root config says, which it never reads', async () => {
    const { clone, first } = await fetchedForRelease();
    await writeFile(join(clone, 'variance.config.json'), 'not json');
    const into = join(home, 'elsewhere.bin');

    await landJourneys(clone, [await shardAt(first)], into);

    expect(existsSync(into)).toBe(true);
  });

  it('lays nothing of it for a caller that hands in the selection', async () => {
    const { clone, own } = await fetchedForRelease();

    await withIndexLock(own, (lock) => prepareRecord(lock, clone, 'fixture', { selected: { mainline: 'main' } }));

    expect(existsSync(own)).toBe(false);
  });

  it('lays what was fetched in a runner seam, which has no selection to hand in, whatever a reader here worked out', async () => {
    const { clone, own } = await fetchedForRelease();

    expect(await suiteBase(clone, { env: {} })).toMatchObject({ from: 'none', missed: { mainline: 'main' } });
    await withIndexLock(own, (lock) => prepareRecord(lock, clone, 'fixture'));

    expect((await readOwnLayer(own))?.pinned).toMatchObject({ mainline: 'release' });
  });
});

describe('a read that fetches nothing', () => {
  it('finds the selected mainline\'s record in the primary checkout, under a newer one of another mainline here', async () => {
    const { clone, first, recorded } = await fetchedForRelease();
    // Each checkout's cache beside it, as a machine has them: the variable would make them one.
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', undefined);
    const older = new Date(Date.now() - 60_000).toISOString();
    const selected = await fetchedInto(clone, recorded, { mainline: 'main', commit: first, fetched: older });
    const tree = join(home, 'tree');
    await git(clone, 'worktree', 'add', '--quiet', '-b', 'tree', tree);
    await fetchedInto(tree, recorded, { mainline: 'release', commit: first, fetched: new Date().toISOString() });

    const base = await suiteBase(tree, { env: {}, fetch: 'never' });

    expect(base).toMatchObject({ from: 'mainline', file: selected, mainline: { mainline: 'main' } });
  });

  it('is not answered by it through `recordedSuite`', async () => {
    const { clone, kept, own } = await fetchedForRelease();

    const { file } = await recordedSuite(clone, 'unit');

    expect(file).not.toBe(kept);
    expect(file).toBe(own);
  });

  it('is not answered by it through `variance coverage`', async () => {
    const { clone } = await fetchedForRelease();

    const answer = await ask(['coverage', '--root', clone, '--suite', 'unit', '--format', 'json']);

    expect(JSON.parse(answer.out)).toEqual({ refused: 'unrecorded' });
  });

  it('is not answered by it through `variance covering`', async () => {
    await fetchedForRelease();

    const answer = await ask(['covering', '--file', 'src/total.ts', '--suite', 'unit', '--format', 'refs']);

    expect(answer.out + answer.err).not.toContain('test/total.test.ts');
  });

  it('is not offered as the record that would close a probes gap', async () => {
    const { clone, kept } = await fetchedForRelease();
    await writeTestCoverage(kept, { version: 3, instrumentation: PROBES, tests: [], modules: [] });
    const record = join(home, 'older.bin');
    await writeTestCoverage(record, { version: 3, instrumentation: 'retired-probes', tests: [], modules: [] });

    const gap = await probesGap(record, clone, 'unit');

    expect(gap).toMatchObject({ recordedUnder: 'retired-probes' });
    expect(gap).not.toHaveProperty('current');
  });

  it('is read by a process with no command line, which has no selection to judge it by, whatever a reader here worked out', async () => {
    const { clone } = await fetchedForRelease();
    const unjudged = recordedPaths(clone);
    expect(unjudged.length).toBeGreaterThan(0);

    await suiteBase(clone, { env: {} });

    expect(recordedPaths(clone)).toEqual(unjudged);
    expect(lastFetchedMainline(clone, 'unit')).toMatchObject({ mainline: 'release' });
  });
});

describe('a reader that computed a selection', () => {
  it('judges by it, when it asks the share', async () => {
    const { clone } = await fetchedForRelease();

    expect(await suiteBase(clone, { env: {} })).toMatchObject({ from: 'none', missed: { mainline: 'main' } });
  });

  it('judges by it, when it fetches nothing', async () => {
    const { clone } = await fetchedForRelease();

    expect(await suiteBase(clone, { env: {}, fetch: 'never' })).toMatchObject({ from: 'none', missed: { mainline: 'main' } });
  });

  it('leaves nothing beside what was fetched, so the next reader works it out again', async () => {
    const { clone } = await fetchedForRelease();
    const kept = mainlineReadRoot(cacheRootFor(clone), 'unit');
    const before = await readdir(kept);

    await suiteBase(clone, { env: {}, fetch: 'never' });
    await recordedSuite(clone, 'unit');

    expect(await readdir(kept)).toEqual(before);
  });
});
