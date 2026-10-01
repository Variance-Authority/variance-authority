import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  declaredSuites,
  landRun,
  readCommitRuns,
  readOwnLayer,
  readTestCoverage,
  seedTestCoverage,
  testCoverageFile,
  writeTestCoverage,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { digestString } from '@variance-authority/core/format';
import type { Env } from '../share-lines.js';
import { checkoutRead } from './checkout-read.js';
import { BEFORE, collectedBoth, DISCOUNTS, gitPublished, PUSH, ranWhole, recordIn } from './mainline-fixture.js';
import { mainlineBase } from './mainline-base.js';
import { suiteBase } from './suite-base.js';
import { publishSuite } from './suite-share.js';

/**
 * Spec 0090 item 1: the milestone under a checkout is pinned, never written,
 * and a newer one HEAD contains replaces it under the tests the checkout did
 * not run itself.
 */

const run = promisify(execFile);
const LOCAL: Env = {};
let home: string;

beforeEach(async () => {
  // Real, because git records a worktree's primary checkout by its real path.
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-milestone-pin-')));
});

afterEach(async () => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

async function git(at: string, ...args: string[]): Promise<string> {
  return (await run('git', ['-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', ...args], { cwd: at })).stdout.trim();
}

/** A laptop worktree at the mainline's first published commit, its record laid from it. */
async function laidWorktree(): Promise<{ ci: string; first: string; worktree: string; own: string }> {
  const { ci, origin, first } = await gitPublished(home);
  const primary = join(home, 'clone');
  await git(home, 'clone', '--quiet', origin, primary);
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'laptop-cache');
  const worktree = join(home, 'feature');
  await git(primary, 'worktree', 'add', '--quiet', '--detach', worktree);
  expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ from: 'mainline', mainline: { commit: first } });
  const own = testCoverageFile(worktree, { suite: 'unit' });
  expect(await seedTestCoverage(own, worktree)).toMatchObject({ from: 'mainline' });
  return { ci, first, worktree, own };
}

/** CI pushes one more commit to main and publishes a whole run there, in which both test files run `applyDiscount`. */
async function publishedNext(ci: string): Promise<string> {
  const laptop = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'ci-cache');
  await git(ci, 'commit', '--quiet', '--allow-empty', '-m', 'next');
  const next = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'push', '--quiet', 'origin', 'main');
  await recordIn(ci, next, ['test/other.test.ts', 'test/total.test.ts'], [DISCOUNTS]);
  // A record opened whole, as a run writes one: the module's first block is the module.
  await writeTestCoverage(testCoverageFile(ci, { suite: 'unit' }), {
    version: 3,
    instrumentation: 'fixture',
    commit: next,
    tests: [
      { file: 'test/other.test.ts', complete: true, preconditions: [] },
      { file: 'test/total.test.ts', complete: true, preconditions: [] },
    ],
    modules: [{
      file: 'src/total.ts',
      sourceDigest: digestString(BEFORE),
      instrumented: true,
      blocks: [{
        ordinal: 0, kind: 'module', digest: digestString('module'), name: '', path: 'module',
        startLine: 1, endLine: 3, source: true, testFiles: ['test/other.test.ts', 'test/total.test.ts'],
      }],
    }],
  });
  await ranWhole(testCoverageFile(ci, { suite: 'unit' }), next);
  const done = await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) });
  if (!('published' in done)) throw new Error(`the record was to reach mainline main: ${JSON.stringify(done)}`);
  process.env['VARIANCE_AUTHORITY_CACHE'] = laptop;
  return next;
}

/** A run of `file` at `commit` that entered no module. */
function ranAlone(commit: string, file: string): TestCoverage {
  return { version: 3, instrumentation: 'fixture', commit, tests: [{ file, complete: true, preconditions: [] }], modules: [] };
}

async function refetch(worktree: string, commit: string): Promise<void> {
  // The share's line was read within the minute a reader reuses it for.
  await run('find', [join(home, 'laptop-cache'), '-path', '*/variance-fetched/*', '-type', 'f', '-exec', 'touch', '-t', '200001010000', '{}', '+']);
  const declared = declaredSuites(worktree)?.find((one) => one.name === 'unit');
  expect(await mainlineBase(worktree, declared, { env: LOCAL, refetch: true })).toMatchObject({ commit });
}

function crossers(record: TestCoverage): readonly string[] {
  return record.modules.find((module) => module.file === 'src/total.ts')?.blocks.flatMap((block) => block.testFiles) ?? [];
}

describe('the milestone under a checkout', () => {
  it('is never written by a local run, and the ledger lists exactly the tests that ran here', async () => {
    const { first, worktree, own } = await laidWorktree();
    const milestone = join(home, 'laptop-cache', 'share', 'read', 'unit', first, 'coverage.bin');
    const fetched = await readFile(milestone);

    await landRun(own, ranAlone(first, 'test/total.test.ts'), worktree);
    await landRun(own, ranAlone(first, 'test/other.test.ts'), worktree);

    expect(await readFile(milestone)).toEqual(fetched);
    expect(await readOwnLayer(own)).toEqual({
      pinned: { mainline: 'main', commit: first },
      ran: [{ commit: first, files: ['test/other.test.ts', 'test/total.test.ts'] }],
    });
  });

  it('moves to a newer snapshot HEAD contains: untouched tests read it, a test run over it keeps its own row', async () => {
    const { ci, first, worktree, own } = await laidWorktree();
    // Over the old milestone, so the new one answers for it.
    await landRun(own, ranAlone(first, 'test/other.test.ts'), worktree);
    const next = await publishedNext(ci);
    await git(worktree, 'fetch', '--quiet', 'origin');
    await git(worktree, 'checkout', '--quiet', '--detach', next);
    await landRun(own, ranAlone(next, 'test/total.test.ts'), worktree);
    expect(crossers(await readTestCoverage(own))).toEqual([]);
    await refetch(worktree, next);

    const base = await suiteBase(worktree, { env: LOCAL });

    expect(base).toMatchObject({
      from: 'own',
      repin: { repinned: true, from: first, to: next, kept: ['test/total.test.ts'], dropped: ['test/other.test.ts'] },
      layer: { pinned: { mainline: 'main', commit: next }, ran: [{ commit: next, files: ['test/total.test.ts'] }] },
    });
    // `other` reads the new milestone's row; `total` keeps its own, which entered nothing.
    expect(crossers(await readTestCoverage(own))).toEqual(['test/other.test.ts']);
    expect(await readCommitRuns(own)).toMatchObject({ commit: next, over: next, files: ['test/total.test.ts'] });
  });

  it('lays a newer snapshot whole when this checkout recorded under other probes', async () => {
    const { ci, worktree, own } = await laidWorktree();
    const next = await publishedNext(ci);
    await git(worktree, 'fetch', '--quiet', 'origin');
    await git(worktree, 'checkout', '--quiet', '--detach', next);
    await landRun(own, { ...ranAlone(next, 'test/total.test.ts'), instrumentation: 'other probes' }, worktree);
    await refetch(worktree, next);

    const base = await suiteBase(worktree, { env: LOCAL });

    expect(base).toMatchObject({ from: 'own', repin: { repinned: true, kept: [], dropped: ['test/total.test.ts'] }, layer: { ran: [] } });
    expect(crossers(await readTestCoverage(own))).toEqual(['test/other.test.ts', 'test/total.test.ts']);
  });

  it('is kept when the newer snapshot is of a commit HEAD does not contain', async () => {
    const { ci, first, worktree, own } = await laidWorktree();
    await landRun(own, ranAlone(first, 'test/total.test.ts'), worktree);
    const laid = await readFile(own);
    const next = await publishedNext(ci);
    // Fetched, and not merged: the branch does not contain it.
    await git(worktree, 'fetch', '--quiet', 'origin');
    await refetch(worktree, next);

    const base = await suiteBase(worktree, { env: LOCAL });

    expect(base).toMatchObject({ from: 'own', repin: { repinned: false, why: 'not-ancestor' }, layer: { pinned: { commit: first } } });
    expect(await readFile(own)).toEqual(laid);
    expect(checkoutRead('unit', worktree, base as Parameters<typeof checkoutRead>[2])).toContain('HEAD does not contain its commit');
  });

  it('names the tests that ran on another branch as such', async () => {
    const { first, worktree, own } = await laidWorktree();
    await git(worktree, 'checkout', '--quiet', '-b', 'elsewhere');
    await git(worktree, 'commit', '--quiet', '--allow-empty', '-m', 'elsewhere');
    const elsewhere = await git(worktree, 'rev-parse', 'HEAD');
    await landRun(own, ranAlone(elsewhere, 'test/other.test.ts'), worktree);
    await git(worktree, 'checkout', '--quiet', '--detach', first);

    const note = checkoutRead('unit', worktree, { layer: (await readOwnLayer(own))! });

    expect(note).toContain(`over mainline main at ${first.slice(0, 12)}, 0 commit(s) before HEAD`);
    expect(note).toContain(`test/other.test.ts at ${elsewhere.slice(0, 12)}, not on this branch`);
  });
});
