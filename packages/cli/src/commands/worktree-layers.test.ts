import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import {
  commitRunsFile,
  readTestCoverage,
  testCoverageFile,
  writeTestCoverage,
} from '@variance-authority/sense/test-selection';
import { landJourneys } from './land.js';
import { git, parseReview, published, selectedIn } from './mainline-fixture.js';
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

/** Both test files whole, and `src/total.ts` as one module block `total.test.ts` entered. */
async function wholeRecord(dir: string): Promise<void> {
  const record = testCoverageFile(dir, { suite: 'unit' });
  await writeTestCoverage(record, {
    version: 3,
    instrumentation: 'fixture',
    commit: await git(dir, 'rev-parse', 'HEAD'),
    tests: [
      { file: 'test/other.test.ts', complete: true, preconditions: [] },
      { file: 'test/total.test.ts', complete: true, preconditions: [] },
    ],
    modules: [{
      file: 'src/total.ts',
      sourceDigest: 'source:total',
      instrumented: true,
      blocks: [{
        ordinal: 0, kind: 'module', digest: 'block:0', name: 'total', path: 'module',
        startLine: 1, endLine: 3, source: true, testFiles: ['test/total.test.ts'],
      }],
    }],
  });
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

  it('lands shards over the primary checkout\'s record and case index on its first `variance land`', async () => {
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
    expect(existsSync(`${own}.cases.bin`)).toBe(true);
  });
});
