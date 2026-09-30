import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareJourneys, recordedCases, recordedDurations, updateSourceIndex } from '@variance-authority/sense';
import {
  commitRunsFile,
  readCommitRuns,
  readTestCoverage,
  seedTestCoverage,
  testCoverageFile,
  writeTestCoverage,
} from '@variance-authority/sense/test-selection';
import { recordedExecutionFile } from './execution-input.js';
import { landJourneys } from './land.js';
import { git, parseReview, published, selectedIn, wholeRecord } from './mainline-fixture.js';
import { review } from './review.js';

/**
 * A git worktree of a primary checkout that has recorded, before the worktree
 * has run anything: the record is read from the primary checkout's cache layer,
 * and what belongs to one checkout's runs is not.
 */

let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  // Real, because git records a worktree's primary checkout by its real path.
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-worktree-layers-')));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'cache');
});

afterEach(async () => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

/**
 * The primary checkout, recorded at its first commit, and a worktree of it cut
 * from `main`. `whole` replaces the record with one a whole decode accepts, for
 * a test that folds into it.
 */
async function worktreeOf(whole = false): Promise<{ primary: string; worktree: string; first: string }> {
  const { dir: primary, first } = await published(home, {
    publish: false,
    ...(whole ? { record: async (dir: string) => wholeRecord(dir) } : {}),
  });
  const worktree = join(home, 'feature');
  await git(primary, 'worktree', 'add', '--quiet', '--detach', worktree);
  return { primary, worktree, first };
}

describe('a worktree that has not run', () => {
  it('says `variance select` read the primary checkout\'s record, and where it is kept', async () => {
    const { primary, worktree } = await worktreeOf();
    await writeFile(join(worktree, 'src/total.ts'), 'export const changed = true;\n');

    const { err } = await selectedIn(worktree);

    const kept = testCoverageFile(primary, { suite: 'unit' });
    expect(err).toContain(
      'record of "unit": read from the primary checkout, because this worktree has recorded none of its own; ' +
        `kept at ${kept}; the mainline's is read only when neither has one.`,
    );
  });

  it('is refused by `variance review` with no base named, rather than starting where the primary checkout\'s runs did', async () => {
    const { primary, worktree, first } = await worktreeOf();
    // The primary checkout moved on and ran there: its runs start at `first`
    // and list what it ran, none of which is this worktree's change.
    await git(primary, 'commit', '--quiet', '--allow-empty', '-m', 'second');
    const second = await git(primary, 'rev-parse', 'HEAD');
    await writeFile(commitRunsFile(testCoverageFile(primary, { suite: 'unit' })), JSON.stringify({
      commit: second, over: first, first: '2026-09-26T00:00:00.000Z', latest: '2026-09-26T00:00:00.000Z', runs: 3, files: ['test/total.test.ts'],
    }));
    await git(worktree, 'checkout', '--quiet', '--detach', second);
    process.chdir(worktree);
    await updateSourceIndex(worktree);

    const own = testCoverageFile(worktree, { suite: 'unit' });
    await expect(review(parseReview(['--root', worktree]))).rejects.toThrow(
      `no run has listed itself beside \`${own}\`, so nothing says where this change starts.`,
    );
    // Named, the base is read against the primary checkout's record, and the
    // primary checkout's runs are not reported as this worktree's.
    const answer = await review(parseReview(['--since', first, '--root', worktree]));
    expect(answer).toMatchObject({ from: first, base: 'since' });
    expect(answer.runs).toBeUndefined();
  });

  it('is refused by `variance review` with no base named after its first `variance land`, whose seeded runs record lists no run of its own', async () => {
    const { worktree, first } = await worktreeOf(true);
    const shard = join(home, 'shard-1.bin');
    await writeTestCoverage(shard, {
      version: 3,
      instrumentation: 'fixture',
      commit: first,
      tests: [{ file: 'test/third.test.ts', complete: true, preconditions: [] }],
      modules: [],
    });
    await landJourneys(worktree, [shard]);
    process.chdir(worktree);
    await updateSourceIndex(worktree);

    // The landing seeded the snapshot, and with it where the base's tests last
    // ran; no run of this worktree is in it, and `over` is the base's to keep.
    const own = testCoverageFile(worktree, { suite: 'unit' });
    const seeded = await readCommitRuns(own);
    expect(seeded).toMatchObject({ commit: first, runs: 0 });
    expect(seeded?.over).toBeUndefined();
    await expect(review(parseReview(['--root', worktree]))).rejects.toThrow(
      `no run has listed itself beside \`${own}\`, so nothing says where this change starts.`,
    );
  });

  it('lands shards over the primary checkout\'s record on its first `variance land`, and drops the copied case index a shard left no cases for', async () => {
    const { primary, worktree, first } = await worktreeOf(true);
    const shard = join(home, 'shard-1.bin');
    await writeTestCoverage(shard, {
      version: 3,
      instrumentation: 'fixture',
      commit: first,
      tests: [{ file: 'test/third.test.ts', complete: true, preconditions: [] }],
      modules: [],
    });

    const landed = await landJourneys(worktree, [shard]);

    const own = testCoverageFile(worktree, { suite: 'unit' });
    expect(landed.at).toBe(own);
    expect(own).not.toBe(testCoverageFile(primary, { suite: 'unit' }));
    expect((await readTestCoverage(own)).tests.map((test) => test.file)).toEqual([
      'test/other.test.ts',
      'test/third.test.ts',
      'test/total.test.ts',
    ]);
    // The shard finished `test/third.test.ts` and left no case index beside
    // it, so the copy of the primary checkout's index cannot answer for it.
    expect(existsSync(`${own}.cases.bin`)).toBe(false);
    await expect(recordedExecutionFile(worktree, 'unit')).rejects.toMatchObject({ kind: 'unrecorded' });
    expect(landed.cases).toEqual({ unanswered: `${own}.cases.bin`, shard, removed: true });
    expect(existsSync(`${testCoverageFile(primary, { suite: 'unit' })}.cases.bin`)).toBe(true);
  });

  it('answers no case question from the primary checkout\'s index once a landing removed its own, and does not copy it again', async () => {
    const { primary, worktree, first } = await worktreeOf(true);
    const shard = join(home, 'shard-1.bin');
    await writeTestCoverage(shard, {
      version: 3,
      instrumentation: 'fixture',
      commit: first,
      tests: [{ file: 'test/third.test.ts', complete: true, preconditions: [] }],
      modules: [],
    });
    await landJourneys(worktree, [shard]);
    const own = testCoverageFile(worktree, { suite: 'unit' });
    const cases = `${own}.cases.bin`;
    expect(existsSync(`${testCoverageFile(primary, { suite: 'unit' })}.cases.bin`)).toBe(true);

    // Each reader opens the index beside the snapshot it reads, which is the
    // worktree's own; the primary checkout's cases are for a snapshot the
    // landing replaced here.
    expect(recordedCases(worktree, ['src/total.ts'], 1)).toEqual([
      { suite: 'unit', recording: cases, unread: 'nothing is recorded there' },
    ]);
    expect(recordedDurations(worktree, 5)[0]).toMatchObject({
      recording: own,
      cases: { recording: cases, unread: 'nothing is recorded there' },
    });
    expect(await prepareJourneys(worktree)).toMatchObject([
      { suite: 'unit', unprepared: `nothing is recorded at ${cases}` },
    ]);

    // The snapshot is already the worktree's own, so a later seed copies no
    // index to sit beside it.
    await seedTestCoverage(own, worktree);
    expect(existsSync(cases)).toBe(false);
  });
});
