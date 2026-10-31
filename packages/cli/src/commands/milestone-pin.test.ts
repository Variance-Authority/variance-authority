import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  caseSectionsAt,
  commitRunsFile,
  encodeAsSetExecutionIndex,
  landRun,
  readCommitRuns,
  readOwnLayer,
  readTestCoverage,
  recordedEyesAt,
  whatLanded,
  withCaseSections,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { digestString } from '@variance-authority/core/format';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { checkoutRead } from './checkout-read.js';
import { covering } from './covering.js';
import { BEFORE, DISCOUNTS, probedModule, ROUNDS } from './mainline-fixture.js';
import { git, laidWorktree, LOCAL, publishedNext, ranAlone, refetch } from './milestone-pin.fixture.js';
import { suiteBase } from './suite-base.js';

// `ci-info` decides CI once, when it loads, so the module is cut: these questions are asked outside CI.
vi.mock('ci-info', () => ({ isCI: false }));

/**
 * Spec 0090 item 1: the milestone under a checkout is pinned, never written,
 * and a newer one HEAD contains replaces it under the tests the checkout did
 * not run itself.
 */

let home: string;

beforeEach(async () => {
  // Real, because git records a worktree's primary checkout by its real path.
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-milestone-pin-')));
});

afterEach(async () => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

/**
 * A checkout at the mainline's next commit whose two tests ran there over one
 * uncommitted lockfile, in two working states: `total` over the lockfile
 * alone, then `other` over a new source file beside it, which gives its state
 * a tree of its own. The bump is then committed and a third test runs, so both
 * stand where they ran, on the install they ran on.
 */
async function standingOverTwoStates(): Promise<{ worktree: string; own: string; next: string; installed: Record<string, string> }> {
  const { ci, worktree, own } = await laidWorktree(home);
  const next = await publishedNext(home, ci);
  await git(worktree, 'fetch', '--quiet', 'origin');
  await git(worktree, 'checkout', '--quiet', '--detach', next);
  const lock = '{ "lockfileVersion": 3, "packages": {} }\n';
  await writeFile(join(worktree, 'package-lock.json'), lock);
  await landRun(own, ranAlone(next, 'test/total.test.ts'), worktree);
  const edited = 'export const edited = 1;\n';
  await writeFile(join(worktree, 'src/edited.ts'), edited);
  await landRun(own, {
    version: 3,
    instrumentation: 'fixture',
    commit: next,
    tests: [{ file: 'test/other.test.ts', complete: true, preconditions: [] }],
    modules: [{
      file: 'src/edited.ts',
      sourceDigest: digestString(edited),
      instrumented: true,
      blocks: [{
        ordinal: 0, kind: 'module', digest: digestString('module'), name: '', path: 'module',
        startLine: 1, endLine: 1, source: true, testFiles: ['test/other.test.ts'],
      }],
    }],
  }, worktree);
  const states = (await readOwnLayer(own))?.ran.filter((state) => state.commit === next);
  expect(states?.map((state) => state.files)).toEqual([['test/total.test.ts'], ['test/other.test.ts']]);
  await git(worktree, 'add', 'package-lock.json', 'src/edited.ts');
  await git(worktree, 'commit', '--quiet', '-m', 'bump');
  const bumped = await git(worktree, 'rev-parse', 'HEAD');
  const atNext = (await readCommitRuns(own))!;
  await landRun(own, ranAlone(bumped, 'test/third.test.ts'), worktree);
  const installed = { 'package-lock.json': digestString(lock) };
  // Each run stands where it ran, with its own time, on the install it ran on.
  expect(atNext.landings?.map((landing) => [landing.files, landing.installed])).toEqual([
    [['test/total.test.ts'], installed],
    [['test/other.test.ts'], installed],
  ]);
  expect((await readCommitRuns(own))?.standing).toEqual(atNext.landings!.map((landing) => ({ commit: next, ...landing })));
  return { worktree, own, next, installed };
}

function crossers(record: TestCoverage): readonly string[] {
  return record.modules.find((module) => module.file === 'src/total.ts')?.blocks.flatMap((block) => block.testFiles) ?? [];
}

describe('the milestone under a checkout', () => {
  it('is never written by a local run, and the ledger lists exactly the tests that ran here', async () => {
    const { first, worktree, own } = await laidWorktree(home);
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
    const { ci, first, worktree, own } = await laidWorktree(home);
    // Over the old milestone, so the new one answers for it.
    await landRun(own, ranAlone(first, 'test/other.test.ts'), worktree);
    const next = await publishedNext(home, ci);
    await git(worktree, 'fetch', '--quiet', 'origin');
    await git(worktree, 'checkout', '--quiet', '--detach', next);
    await landRun(own, ranAlone(next, 'test/total.test.ts'), worktree);
    expect(crossers(await readTestCoverage(own))).toEqual([]);
    await refetch(home, worktree, next);

    const base = await suiteBase(worktree, { env: LOCAL });

    expect(base).toMatchObject({
      from: 'own',
      repin: { repinned: true, from: first, to: next, kept: ['test/total.test.ts'], dropped: ['test/other.test.ts'] },
      layer: { pinned: { mainline: 'main', commit: next }, ran: [{ commit: next, files: ['test/total.test.ts'] }] },
    });
    // `other` reads the new milestone's row; `total` keeps its own, which entered nothing.
    expect(crossers(await readTestCoverage(own))).toEqual(['test/other.test.ts']);
    // `other` stands where the publishing run ran it, when that run landed.
    const runs = await readCommitRuns(own);
    expect(runs).toMatchObject({
      commit: next,
      over: next,
      standing: [{ commit: next, files: ['test/other.test.ts'], first: '2026-01-01T00:00:00.000Z', latest: '2026-01-01T00:00:00.000Z', runs: 1 }],
    });
    expect(whatLanded(runs!.landings).files).toEqual(['test/total.test.ts']);
  });

  it('answers a test file standing at the new milestone over the text the publishing run ran it over, when that run landed', async () => {
    const { ci, first, worktree, own } = await laidWorktree(home);
    await landRun(own, ranAlone(first, 'test/total.test.ts'), worktree);
    // CI ran both test files over an uncommitted text of `src/total.ts`, which its landing kept the digest of,
    // and `discounts` entered `applyDiscount` there.
    const next = await publishedNext(home, ci, async (record) => {
      const runs = JSON.parse(await readFile(commitRunsFile(record), 'utf8')) as { landings: Record<string, unknown>[] };
      const texts = { 'src/total.ts': digestString(`${BEFORE}// on CI\n`) };
      await writeFile(commitRunsFile(record), JSON.stringify({ ...runs, landings: runs.landings.map((landing) => ({ ...landing, texts })) }));
      const block = { kind: 'function', name: 'applyDiscount', path: 'applyDiscount', startLine: 1, endLine: 3, source: true, crossings: [{ test: 0, distance: 0 }] };
      await writeFile(record, withCaseSections(await readFile(record), {
        index: encodeAsSetExecutionIndex({ tests: [DISCOUNTS], modules: [{ file: 'src/total.ts', blocks: [block] }] }),
      }));
    });
    await git(worktree, 'fetch', '--quiet', 'origin');
    await git(worktree, 'checkout', '--quiet', '--detach', next);
    await landRun(own, ranAlone(next, 'test/other.test.ts'), worktree);
    await refetch(home, worktree, next);
    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ repin: { repinned: true, to: next, dropped: ['test/total.test.ts'] } });

    const argv = ['--file', 'src/total.ts', '--root', worktree, '--suite', 'unit'];
    const answer = await covering(parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering'))));

    expect(answer).toMatchObject({
      frame: 'recorded',
      ran: { stands: [{ commit: next, tests: ['test/total.test.ts'], landed: { first: '2026-01-01T00:00:00.000Z', runs: 1 }, text: 'other', other: ['src/total.ts'] }] },
    });
  });

  it('drops the install of a runs record it moves to the snapshot\'s commit, which that install was not measured against', async () => {
    const { ci, first, worktree, own } = await laidWorktree(home);
    const next = await publishedNext(home, ci);
    await git(worktree, 'fetch', '--quiet', 'origin');
    await git(worktree, 'checkout', '--quiet', '--detach', next);
    await landRun(own, ranAlone(next, 'test/total.test.ts'), worktree);
    // A crash left the record naming the old commit, with an install measured against it.
    const runs = commitRunsFile(own);
    const held = JSON.parse(await readFile(runs, 'utf8')) as { landings: Record<string, unknown>[] };
    const installed = { 'package-lock.json': digestString('measured at the old commit') };
    await writeFile(runs, JSON.stringify({ ...held, commit: first, landings: held.landings.map((landing) => ({ ...landing, installed })) }));
    await refetch(home, worktree, next);

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ repin: { repinned: true } });

    const repinned = await readCommitRuns(own);
    expect(repinned).toMatchObject({ commit: next });
    expect(repinned!.landings.length).toBeGreaterThan(0);
    expect(repinned!.landings.filter((landing) => landing.installed !== undefined)).toEqual([]);
  });

  it('keeps the install a standing test ran on when it moves to a newer snapshot', async () => {
    const { ci, worktree, own } = await laidWorktree(home);
    const next = await publishedNext(home, ci);
    await git(worktree, 'fetch', '--quiet', 'origin');
    await git(worktree, 'checkout', '--quiet', '--detach', next);
    // Both tests run over a lockfile not yet committed; the bump is then
    // committed and one test runs again, so the other stands where it ran.
    const lock = '{ "lockfileVersion": 3, "packages": {} }\n';
    await writeFile(join(worktree, 'package-lock.json'), lock);
    const both = ['test/other.test.ts', 'test/total.test.ts'];
    await landRun(own, {
      version: 3,
      instrumentation: 'fixture',
      commit: next,
      tests: both.map((file) => ({ file, complete: true, preconditions: [] })),
      modules: [probedModule(both)],
    }, worktree);
    await git(worktree, 'add', 'package-lock.json');
    await git(worktree, 'commit', '--quiet', '-m', 'bump');
    const bumped = await git(worktree, 'rev-parse', 'HEAD');
    await landRun(own, ranAlone(bumped, 'test/total.test.ts'), worktree);
    const installed = { 'package-lock.json': digestString(lock) };
    expect(await readCommitRuns(own)).toMatchObject({ standing: [{ commit: next, files: ['test/other.test.ts'], installed }] });
    await refetch(home, worktree, next);

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ repin: { repinned: true, to: next } });

    expect(await readCommitRuns(own)).toMatchObject({ commit: bumped, standing: [{ commit: next, files: ['test/other.test.ts'], installed }] });
  });

  it('stands the tests that ran at one commit on one install in one entry per run, each with its own time', async () => {
    const { worktree, own, next } = await standingOverTwoStates();
    const ran = [...((await readCommitRuns(own))?.standing ?? [])].filter((entry) => entry.commit === next);
    await refetch(home, worktree, next);

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ repin: { repinned: true, to: next } });

    // The ledger lists `total`'s state first; each run's tests keep that run's
    // time, which no other run's spans.
    const total = ran.find((entry) => entry.files.includes('test/total.test.ts'))!;
    const other = ran.find((entry) => entry.files.includes('test/other.test.ts'))!;
    expect(total).not.toBe(other);
    expect((await readCommitRuns(own))?.standing).toEqual([
      { ...total, files: ['test/total.test.ts'] },
      { ...other, files: ['test/other.test.ts'] },
    ]);
  });

  it('stands the tests that ran at one commit on two installs as two entries', async () => {
    const { worktree, own, next, installed } = await standingOverTwoStates();
    const otherInstall = { 'package-lock.json': digestString('another lockfile') };
    const runs = commitRunsFile(own);
    const held = JSON.parse(await readFile(runs, 'utf8')) as Record<string, unknown>;
    await writeFile(runs, JSON.stringify({
      ...held,
      standing: [
        { commit: next, files: ['test/total.test.ts'], installed: otherInstall },
        { commit: next, files: ['test/other.test.ts'], installed },
      ],
    }));
    await refetch(home, worktree, next);

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ repin: { repinned: true, to: next } });

    expect((await readCommitRuns(own))?.standing).toEqual([
      { commit: next, files: ['test/total.test.ts'], installed: otherInstall },
      { commit: next, files: ['test/other.test.ts'], installed },
    ]);
  });

  it('carries the Eyes journals of the cases it keeps: its own for the tests it ran, the newer snapshot\'s for the rest', async () => {
    const OTHER = { id: 'test/other.test.ts > other', file: 'test/other.test.ts', name: 'other' };
    const journal = (by: string) => ({ complete: true, attention: [], by });
    const { ci, worktree, own } = await laidWorktree(home);
    const next = await publishedNext(home, ci, async (record) => {
      await writeFile(record, withCaseSections(await readFile(record), {
        index: encodeAsSetExecutionIndex({ tests: [DISCOUNTS, OTHER], modules: [] }),
        eyes: Buffer.from(`${JSON.stringify({
          version: 1,
          watched: [DISCOUNTS.id, OTHER.id],
          journals: [
            { case: DISCOUNTS.id, attempt: 1, journal: journal('milestone') },
            { case: OTHER.id, attempt: 1, journal: journal('milestone') },
          ],
        })}\n`),
      }));
    });
    await git(worktree, 'fetch', '--quiet', 'origin');
    await git(worktree, 'checkout', '--quiet', '--detach', next);
    await landRun(own, ranAlone(next, 'test/total.test.ts'), worktree, undefined, {
      fresh: encodeAsSetExecutionIndex({ tests: [ROUNDS], modules: [] }),
      run: { tests: [{ file: 'test/total.test.ts', complete: true }], commit: next },
      eyes: { watched: [ROUNDS.id], journals: [{ case: ROUNDS.id, attempt: 1, journal: journal('here') }] },
    });
    await refetch(home, worktree, next);

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ repin: { repinned: true, kept: ['test/total.test.ts'] } });

    expect(caseSectionsAt(own).index).toBeDefined();
    // `discounts` is no case of this checkout's `total.test.ts`, and its journal goes with it.
    expect(recordedEyesAt(own)).toEqual({
      watched: [OTHER.id, ROUNDS.id],
      journals: [
        { case: OTHER.id, attempt: 1, journal: journal('milestone') },
        { case: ROUNDS.id, attempt: 1, journal: journal('here') },
      ],
    });
  });

  it('lays a newer snapshot whole when this checkout recorded under other probes', async () => {
    const { ci, worktree, own } = await laidWorktree(home);
    const next = await publishedNext(home, ci);
    await git(worktree, 'fetch', '--quiet', 'origin');
    await git(worktree, 'checkout', '--quiet', '--detach', next);
    // A run is never laid over a record of other probes, so this one starts the
    // checkout's record afresh, as the record of a build under other probes.
    await rm(own);
    await landRun(own, { ...ranAlone(next, 'test/total.test.ts'), instrumentation: 'other probes' }, worktree);
    await refetch(home, worktree, next);

    const base = await suiteBase(worktree, { env: LOCAL });

    expect(base).toMatchObject({ from: 'own', repin: { repinned: true, kept: [], dropped: ['test/total.test.ts'] }, layer: { ran: [] } });
    expect(crossers(await readTestCoverage(own))).toEqual(['test/other.test.ts', 'test/total.test.ts']);
  });

  it('is kept when the newer snapshot is of a commit HEAD does not contain', async () => {
    const { ci, first, worktree, own } = await laidWorktree(home);
    await landRun(own, ranAlone(first, 'test/total.test.ts'), worktree);
    const laid = await readFile(own);
    const next = await publishedNext(home, ci);
    // Fetched, and not merged: the branch does not contain it.
    await git(worktree, 'fetch', '--quiet', 'origin');
    await refetch(home, worktree, next);

    const base = await suiteBase(worktree, { env: LOCAL });

    expect(base).toMatchObject({ from: 'own', repin: { repinned: false, why: 'not-ancestor' }, layer: { pinned: { commit: first } } });
    expect(await readFile(own)).toEqual(laid);
    expect(await checkoutRead('unit', worktree, base as Parameters<typeof checkoutRead>[2])).toContain('HEAD does not contain its commit');
  });

  it('names the tests that ran on another branch as such', async () => {
    const { first, worktree, own } = await laidWorktree(home);
    await git(worktree, 'checkout', '--quiet', '-b', 'elsewhere');
    await git(worktree, 'commit', '--quiet', '--allow-empty', '-m', 'elsewhere');
    const elsewhere = await git(worktree, 'rev-parse', 'HEAD');
    await landRun(own, ranAlone(elsewhere, 'test/other.test.ts'), worktree);
    await git(worktree, 'checkout', '--quiet', '--detach', first);

    const note = await checkoutRead('unit', worktree, { layer: (await readOwnLayer(own))! });

    expect(note).toContain(`over mainline main at ${first.slice(0, 12)}, 0 commit(s) before HEAD`);
    expect(note).toContain(`test/other.test.ts at ${elsewhere.slice(0, 12)}, not on this branch`);
  });
});
