import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { writeFetchedMainline } from '@variance-authority/sense/test-selection';
import {
  CACHE_PRUNE_REASONS,
  COMMITS_BEHIND,
  planCachePrune,
  pruneCacheWhenDue,
  prunedLines,
  type CacheOwners,
} from './prune-cache.js';
import { cacheFinding, formatCache } from './doctor-cache.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 27);

async function put(path: string, age: number): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, 'x');
  const when = (NOW - age) / 1000;
  await utimes(path, when, when);
  return path;
}

function commit(n: number): string {
  return n.toString(16).padStart(40, '0');
}

/** Git as a table: how far `HEAD` is past each commit. */
function owners(past: Record<string, number | false | undefined>): CacheOwners {
  return { now: NOW, past: async (sha) => past[sha] };
}

describe('planCachePrune', () => {
  test('a suite index more than 200 commits behind HEAD is removed, and one 199 behind stays', async () => {
    const cacheRoot = await mkdtemp(resolve(tmpdir(), 'va-prune-cache-'));
    const far = await put(join(cacheRoot, 'suite', 'web', `${commit(1)}.bin`), 3 * DAY);
    await put(join(cacheRoot, 'suite', 'web', `${commit(2)}.bin`), 2 * DAY);
    await put(join(cacheRoot, 'suite', 'web', `${commit(3)}.bin`), 0);

    const plan = await planCachePrune(
      { cacheRoot },
      owners({ [commit(1)]: COMMITS_BEHIND + 1, [commit(2)]: COMMITS_BEHIND - 1, [commit(3)]: 0 }),
    );

    expect(plan.remove.map((entry) => [entry.path, entry.reason])).toEqual([[far, 'behind']]);
  });

  test('a commit HEAD does not contain is kept at 13 days and removed at 15', async () => {
    const cacheRoot = await mkdtemp(resolve(tmpdir(), 'va-prune-cache-'));
    const read = join(cacheRoot, 'share', 'read', 'unit');
    const old = await put(join(read, commit(1), 'coverage.bin'), 15 * DAY).then(dirname);
    await utimes(old, (NOW - 15 * DAY) / 1000, (NOW - 15 * DAY) / 1000);
    const young = await put(join(read, commit(2), 'coverage.bin'), 13 * DAY).then(dirname);
    await utimes(young, (NOW - 13 * DAY) / 1000, (NOW - 13 * DAY) / 1000);
    await put(join(read, commit(3), 'coverage.bin'), 0);

    const plan = await planCachePrune({ cacheRoot }, owners({ [commit(1)]: false, [commit(2)]: false, [commit(3)]: 0 }));

    expect(plan.remove.map((entry) => [entry.path, entry.reason])).toEqual([[old, 'off-line']]);
  });

  test('the mainline record a suite\'s fetched.json names stays, however far out of reach its commit is', async () => {
    const cacheRoot = await mkdtemp(resolve(tmpdir(), 'va-prune-cache-'));
    const read = join(cacheRoot, 'share', 'read', 'unit');
    const named = await put(join(read, commit(1), 'coverage.bin'), 15 * DAY).then(dirname);
    await utimes(named, (NOW - 15 * DAY) / 1000, (NOW - 15 * DAY) / 1000);
    const other = await put(join(read, commit(2), 'coverage.bin'), 15 * DAY).then(dirname);
    await utimes(other, (NOW - 15 * DAY) / 1000, (NOW - 15 * DAY) / 1000);
    await put(join(read, commit(3), 'coverage.bin'), 0);
    await writeFetchedMainline(cacheRoot, 'unit', { mainline: 'main', commit: commit(1), fetched: new Date(NOW).toISOString() });

    const plan = await planCachePrune({ cacheRoot }, owners({ [commit(1)]: false, [commit(2)]: false, [commit(3)]: 0 }));

    expect(plan.remove.map((entry) => [entry.path, entry.reason])).toEqual([[other, 'off-line']]);
  });

  test('a commit git cannot answer for is kept, and said, until it is 30 days old', async () => {
    const cacheRoot = await mkdtemp(resolve(tmpdir(), 'va-prune-cache-'));
    const young = await put(join(cacheRoot, 'suite', 'other', `${commit(1)}.bin`), 29 * DAY);
    const old = await put(join(cacheRoot, 'suite', 'other', `${commit(2)}.bin`), 31 * DAY);
    await put(join(cacheRoot, 'suite', 'other', `${commit(3)}.bin`), 0);

    const plan = await planCachePrune({ cacheRoot }, owners({}));

    expect(plan.remove.map((entry) => [entry.path, entry.reason])).toEqual([[old, 'unheld']]);
    expect(plan.kept.map((entry) => entry.path)).toEqual([young]);
  });

  test('the newest entry of a project stays, however far behind it is', async () => {
    const cacheRoot = await mkdtemp(resolve(tmpdir(), 'va-prune-cache-'));
    await put(join(cacheRoot, 'suite', 'web', `${commit(1)}.bin`), 90 * DAY);

    const plan = await planCachePrune({ cacheRoot }, owners({ [commit(1)]: 5000 }));

    expect(plan.remove).toEqual([]);
  });

  test('a shared report is aged out at 14 days, and scans/ is removed whole', async () => {
    const cacheRoot = await mkdtemp(resolve(tmpdir(), 'va-prune-cache-'));
    const old = await put(join(cacheRoot, 'report', 'aaaa.images.json'), 15 * DAY);
    await put(join(cacheRoot, 'report', 'bbbb.images.json'), 13 * DAY);
    await put(join(cacheRoot, 'scans', 'x', 'scan.bin'), 0);

    const plan = await planCachePrune({ cacheRoot }, owners({}), { measure: true });

    expect(plan.remove.map((entry) => [entry.path, entry.reason])).toEqual([
      [old, 'old-report'],
      [join(cacheRoot, 'scans'), 'unwritten'],
    ]);
    expect(plan.held).toBe(3);
  });
});

test('pruneCacheWhenDue prunes once a day and says what it took', async () => {
  const cacheRoot = await mkdtemp(resolve(tmpdir(), 'va-prune-cache-'));
  await put(join(cacheRoot, 'scans', 'scan.bin'), 0);

  const first = await pruneCacheWhenDue({ cacheRoot }, owners({}));
  expect(existsSync(join(cacheRoot, 'scans'))).toBe(false);
  expect(prunedLines({ selection: undefined, commits: first })).toMatch(
    /^cache: freed 0\.0 MiB in .*: 1 directory nothing writes any more\n$/u,
  );

  await put(join(cacheRoot, 'scans', 'scan.bin'), 0);
  expect(await pruneCacheWhenDue({ cacheRoot }, owners({}))).toBeUndefined();
  expect(existsSync(join(cacheRoot, 'scans'))).toBe(true);
});

test('doctor reports what the next prune removes, by rule, and what it keeps and why', () => {
  const lines = formatCache(
    cacheFinding({
      root: '/cache',
      held: 20 * 1024 * 1024,
      remove: [
        { path: '/cache/scans', bytes: 8 * 1024 * 1024, words: CACHE_PRUNE_REASONS.unwritten },
        { path: '/cache/suite/web/1.bin', bytes: 1024 * 1024, words: CACHE_PRUNE_REASONS.behind },
        { path: '/cache/suite/web/2.bin', bytes: 1024 * 1024, words: CACHE_PRUNE_REASONS.behind },
      ],
      kept: [{ path: '/cache/suite/other/3.bin', reason: 'a commit this clone does not hold; kept until 30 days old' }],
    }),
  );

  expect(lines).toEqual([
    'cache: 20.0 MiB besides renders',
    '  /cache',
    '  a run prunes it once a day; `variance doctor --prune` prunes it now',
    '  the next prune removes 10.0 MiB:',
    '    1 directory nothing writes any more, 8.0 MiB',
    `    2 commits more than ${COMMITS_BEHIND} behind HEAD, 2.0 MiB`,
    '  kept, because the rule for them could not be checked:',
    '    1: a commit this clone does not hold; kept until 30 days old',
  ]);
});
