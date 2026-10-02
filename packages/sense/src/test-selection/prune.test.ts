import { chmod, mkdir, mkdtemp, stat, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, onTestFinished, test } from 'vitest';
import { CHECKOUT_MARKER, checkoutKey } from './cache-layers.js';
import {
  applyPrune,
  planPrune,
  prunedLine,
  pruneWhenDue,
  machineOwners,
  scratchPid,
  PRUNE_EVERY_MS,
  type PruneOwners,
} from './prune.js';
import { testCoverageFile } from './record-location.js';

const DAY = 24 * 60 * 60 * 1000;

// A read-only parent is how a removal is refused here, and permission bits
// bind neither the superuser nor Windows: there, nothing refuses.
const refuses = process.platform !== 'win32' && process.getuid?.() !== 0;
const NOW = Date.UTC(2026, 8, 27);

/** A cache under a temporary root, with every file dated by the test rather than the clock. */
async function cache(): Promise<string> {
  return await mkdtemp(resolve(tmpdir(), 'va-prune-'));
}

async function put(path: string, age: number, text = 'x'): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  await date(path, age);
  return path;
}

async function date(path: string, age: number): Promise<void> {
  const when = (NOW - age) / 1000;
  await utimes(path, when, when);
}

async function marker(layer: string, checkout: string, primary: string, age: number): Promise<void> {
  await put(join(layer, CHECKOUT_MARKER), age, JSON.stringify({ checkout, primary }));
  await date(layer, age);
}

function owners(answers: Partial<PruneOwners> = {}): PruneOwners {
  return { now: NOW, alive: async () => false, exists: () => true, worktrees: async () => [], ...answers };
}

describe('planPrune', () => {
  test('a layer whose marked checkout is gone is removed, and one whose checkout is there keeps its recording', async () => {
    const root = await cache();
    const gone = join(root, 'test-selection', 'aaa');
    const here = join(root, 'test-selection', 'bbb');
    await put(join(gone, 'coverage.bin'), DAY);
    await marker(gone, '/gone', '/gone', DAY);
    await put(join(here, 'coverage.bin'), 90 * DAY);
    await marker(here, '/here', '/here', 90 * DAY);

    const plan = await planPrune(root, owners({ exists: (path) => path === '/here' }));

    expect(plan.remove.map((entry) => [entry.path, entry.reason])).toEqual([[gone, 'gone']]);
    expect(plan.remove[0]!.bytes).toBeGreaterThan(0);
  });

  test('a layer naming no checkout is kept until nothing in it was written for 30 days', async () => {
    const root = await cache();
    const young = join(root, 'test-selection', 'young');
    const old = join(root, 'test-selection', 'old');
    await put(join(young, 'coverage.bin'), 29 * DAY);
    await date(young, 29 * DAY);
    await put(join(old, 'coverage.bin'), 31 * DAY);
    await date(old, 31 * DAY);

    const plan = await planPrune(root, owners());

    expect(plan.remove.map((entry) => [entry.path, entry.reason])).toEqual([[old, 'unplaced']]);
    expect(plan.kept.map((entry) => entry.path)).toEqual([young]);
  });

  test('a worktree layer git no longer lists is removed; a listed one and a fresh one stay', async () => {
    const root = await cache();
    const repository = join(root, 'test-selection', 'repo');
    await marker(repository, '/primary', '/primary', DAY);
    const work = join(repository, '.work');
    const listed = join(work, checkoutKey('/primary/.claude/worktrees/kept'));
    const unlisted = join(work, checkoutKey('/primary/.claude/worktrees/dropped'));
    const fresh = join(work, checkoutKey('/primary/.claude/worktrees/new'));
    for (const [layer, age] of [[listed, 5 * DAY], [unlisted, 5 * DAY], [fresh, DAY / 2]] as const) {
      await put(join(layer, 'coverage.bin'), age);
      await date(layer, age);
    }

    const plan = await planPrune(
      root,
      owners({ worktrees: async () => ['/primary', '/primary/.claude/worktrees/kept'] }),
    );

    expect(plan.remove.map((entry) => [entry.path, entry.reason])).toEqual([[unlisted, 'unlisted']]);
  });

  test('when git cannot list the worktrees, an unmarked layer is kept and the plan says why', async () => {
    const root = await cache();
    const repository = join(root, 'test-selection', 'repo');
    await marker(repository, '/primary', '/primary', DAY);
    const layer = join(repository, '.work', 'feature');
    await put(join(layer, 'coverage.bin'), 5 * DAY);
    await date(layer, 5 * DAY);

    const plan = await planPrune(root, owners({ worktrees: async () => undefined }));

    expect(plan.remove).toEqual([]);
    expect(plan.kept).toEqual([{ path: layer, reason: expect.stringContaining('git could not list the worktrees') }]);
  });

  test('when no marker names the primary checkout, git is not asked and the plan says so', async () => {
    const root = await cache();
    const repository = join(root, 'test-selection', 'repo');
    const layer = join(repository, '.work', 'feature');
    await put(join(layer, 'coverage.bin'), 5 * DAY);
    await date(layer, 5 * DAY);
    await date(repository, 5 * DAY);
    const asked: string[] = [];

    const plan = await planPrune(root, owners({ worktrees: async (primary) => { asked.push(primary); return []; } }));

    expect(asked).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.kept).toContainEqual({ path: layer, reason: expect.stringContaining('neither does the repository it sits in') });
  });

  test('a dead run older than an hour is removed; a live one, or a young one, stays', async () => {
    const root = await cache();
    const layer = join(root, 'test-selection', 'repo');
    await marker(layer, '/primary', '/primary', DAY);
    const dead = await put(join(layer, '.run-111-abc', 'part.bin'), 2 * 60 * 60 * 1000).then(dirname);
    await date(dead, 2 * 60 * 60 * 1000);
    const live = await put(join(layer, '.run-222-abc', 'part.bin'), 2 * 60 * 60 * 1000).then(dirname);
    await date(live, 2 * 60 * 60 * 1000);
    const young = await put(join(layer, '.run-333-abc', 'part.bin'), 60 * 1000).then(dirname);
    await date(young, 60 * 1000);
    const suiteTemporary = await put(join(layer, 'suites', 'unit', 'coverage.bin.444-x.tmp'), 2 * 60 * 60 * 1000);

    const plan = await planPrune(root, owners({ alive: async (pid) => pid === 222 }));

    expect(plan.remove.map((entry) => [entry.path, entry.reason]).sort()).toEqual(
      [[dead, 'dead-run'], [suiteTemporary, 'dead-run']].sort(),
    );
  });

  test('a landing that died leaves its staged snapshot where prune removes it', async () => {
    const root = await cache();
    const checkout = await mkdtemp(resolve(tmpdir(), 'va-prune-checkout-'));
    // The file `variance journeys <shard.bin>...` lands on when no `--into`
    // names another: the checkout's own record, inside the cache. Its staged
    // copy is named beside it.
    const target = testCoverageFile(checkout, { cacheRoot: root });
    await marker(dirname(target), checkout, checkout, DAY);
    await put(target, DAY);
    const staged = await put(`${target}.4242-3f0c9a52-7d1e-4b6a-9c2f-5e8d1a0b4c77.tmp`, 2 * 60 * 60 * 1000);

    const plan = await planPrune(root, owners({ exists: (path) => path === checkout }));

    expect(plan.remove.map((entry) => [entry.path, entry.reason])).toEqual([[staged, 'dead-run']]);
  });

  test('a story older than 14 days is removed and a newer one stays', async () => {
    const root = await cache();
    const layer = join(root, 'test-selection', 'repo');
    await marker(layer, '/primary', '/primary', DAY);
    const old = await put(join(layer, 'coverage.stories', 'a.story'), 15 * DAY);
    await put(join(layer, 'coverage.stories', 'b.story'), 13 * DAY);

    const plan = await planPrune(root, owners());

    expect(plan.remove.map((entry) => [entry.path, entry.reason])).toEqual([[old, 'old-story']]);
  });

  test('measuring totals the bytes under test-selection', async () => {
    const root = await cache();
    const layer = join(root, 'test-selection', 'repo');
    await marker(layer, '/primary', '/primary', DAY);
    await put(join(layer, 'coverage.bin'), DAY, '12345');

    expect((await planPrune(root, owners())).held).toBeUndefined();
    expect((await planPrune(root, owners(), { measure: true })).held).toBeGreaterThanOrEqual(5);
  });
});

describe('applyPrune and pruneWhenDue', () => {
  test('applying removes exactly what the plan names, and the line says what was taken', async () => {
    const root = await cache();
    const gone = join(root, 'test-selection', 'aaa');
    const kept = join(root, 'test-selection', 'bbb');
    await marker(gone, '/gone', '/gone', DAY);
    await marker(kept, '/here', '/here', DAY);

    const pruned = await applyPrune(await planPrune(root, owners({ exists: (path) => path === '/here' })));

    expect(existsSync(gone)).toBe(false);
    expect(existsSync(kept)).toBe(true);
    expect(prunedLine(pruned)).toMatch(/^cache: freed \d+\.\d MiB in .*test-selection: 1 checkout that no longer exists$/u);
    expect(prunedLine({ root, removed: [], unremoved: [], freed: 0 })).toBe('');
  });

  test.runIf(refuses)('an entry that could not be removed is reported with its path and the error, and is not counted as freed', async () => {
    const root = await cache();
    const selection = join(root, 'test-selection');
    const stuck = join(selection, 'aaa');
    await marker(stuck, '/gone', '/gone', DAY);
    const plan = await planPrune(root, owners({ exists: () => false }));
    // A parent the process cannot write: the entry cannot be unlinked from it.
    await chmod(selection, 0o555);
    onTestFinished(() => chmod(selection, 0o755));

    const pruned = await applyPrune(plan);

    expect(existsSync(stuck)).toBe(true);
    expect(pruned.removed).toEqual([]);
    expect(pruned.freed).toBe(0);
    expect(pruned.unremoved.map((entry) => [entry.path, entry.reason])).toEqual([[stuck, 'gone']]);
    expect(pruned.unremoved[0]?.error).toMatch(/EACCES|EPERM/u);
    expect(prunedLine(pruned)).toBe(
      `cache: could not remove ${stuck}, a checkout that no longer exists: ${pruned.unremoved[0]?.error}`,
    );
  });

  test('prunes at most once a day, stamped before the walk', async () => {
    const root = await cache();
    const gone = join(root, 'test-selection', 'aaa');
    await marker(gone, '/gone', '/gone', DAY);
    const answers = owners({ exists: () => false });

    expect((await pruneWhenDue(root, answers))?.removed.length).toBe(1);
    await marker(gone, '/gone', '/gone', DAY);
    expect(await pruneWhenDue(root, answers)).toBeUndefined();
    expect(existsSync(gone)).toBe(true);
    expect((await pruneWhenDue(root, { ...answers, now: NOW + PRUNE_EVERY_MS + 1 }))?.removed.length).toBe(1);
    expect((await stat(join(root, 'test-selection', '.pruned'))).mtimeMs).toBe(NOW + PRUNE_EVERY_MS + 1);
  });

  test('a cache with no test-selection directory is left as it is', async () => {
    const root = await cache();
    expect(await pruneWhenDue(root, owners())).toBeUndefined();
    expect(existsSync(join(root, 'test-selection'))).toBe(false);
  });
});

test('a running process is the writer only of what was written after it started', async () => {
  const { alive } = machineOwners();
  expect(await alive(process.pid, Date.now())).toBe(true);
  // A process id reused: this process did not exist a year ago.
  expect(await alive(process.pid, Date.now() - 365 * DAY)).toBe(false);
});

test('scratchPid reads the process a scratch name belongs to', () => {
  expect(scratchPid('.run-4242-9f')).toBe(4242);
  expect(scratchPid('coverage.bin.4242-x.tmp')).toBe(4242);
  expect(scratchPid('coverage.bin.4242.3.tmp')).toBe(4242);
  expect(scratchPid('coverage.bin.1092.seed')).toBe(0x1092);
  expect(scratchPid('orphan.tmp')).toBeUndefined();
  expect(scratchPid('coverage.bin')).toBeNull();
});
