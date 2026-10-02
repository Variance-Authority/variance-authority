import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import {
  commitRunsFile,
  landRun,
  readCommitRuns,
  seedTestCoverage,
  testCoverageFile,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import type { Env } from '../share-lines.js';
import { DISCOUNTS, PUSH, gitPublished, parseReview, probedModule, recordIn, selectedIn } from './mainline-fixture.js';
import { review } from './review.js';
import { suiteBase } from './suite-base.js';
import { publishSuite } from './suite-share.js';

/**
 * A worktree whose first record is the one its mainline published: what its
 * first run lays itself over, and what every reader does with a fetched record
 * this build does not read.
 */

const run = promisify(execFile);
const LOCAL: Env = {};
let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  // Real, because git records a worktree's primary checkout by its real path.
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-mainline-lay-')));
});

afterEach(async () => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

async function git(at: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd: at })).stdout.trim();
}

/**
 * A mainline that published at its second commit `head`, from a run laid over
 * its first, as CI's runs on `main` are; and a laptop's worktree at `head`,
 * with the mainline's record fetched and nothing run.
 */
async function worktreeAtPublished(): Promise<{ first: string; head: string; worktree: string }> {
  const { ci, origin, first } = await gitPublished(home, { publish: false });
  await git(ci, 'commit', '--quiet', '--allow-empty', '-m', 'second');
  const head = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'push', '--quiet', 'origin', 'main');
  await recordIn(ci, head, ['test/total.test.ts'], [DISCOUNTS]);
  const files = ['test/other.test.ts', 'test/total.test.ts'];
  const at = '2026-01-01T00:00:00.000Z';
  await writeFile(
    commitRunsFile(testCoverageFile(ci, { suite: 'unit' })),
    JSON.stringify({ commit: head, over: first, first: at, latest: at, runs: 1, files, standing: [] }),
  );
  const collected = join(home, 'collected.txt');
  await writeFile(collected, `${files.join('\n')}\n`);
  const done = await publishSuite(ci, 'unit', { env: PUSH }, { collected });
  if (!('published' in done)) throw new Error(`the record was to reach mainline main: ${JSON.stringify(done)}`);

  const primary = join(home, 'clone');
  await git(home, 'clone', '--quiet', origin, primary);
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'laptop-cache');
  await recordIn(primary, head, ['test/other.test.ts'], [DISCOUNTS]);
  const worktree = join(home, 'feature');
  await git(primary, 'worktree', 'add', '--quiet', '--detach', worktree);
  expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ from: 'mainline', mainline: { commit: head } });
  return { first, head, worktree };
}

describe('a worktree at the commit its mainline published', () => {
  it('has no run listed before it runs, and its first run starts its change there rather than where CI\'s run did', async () => {
    const { head, worktree } = await worktreeAtPublished();
    const own = testCoverageFile(worktree, { suite: 'unit' });
    await seedTestCoverage(own, worktree);
    process.chdir(worktree);
    await updateSourceIndex(worktree);

    // The mainline's runs are laid as a seed: where its tests last ran, and no run of this worktree's.
    expect(await readCommitRuns(own)).toMatchObject({ commit: head, runs: 0, standing: [] });
    await expect(review(parseReview(['--root', worktree]))).rejects.toThrow(
      `no run has listed itself beside \`${own}\`, so nothing says where this change starts.`,
    );

    const ran: TestCoverage = {
      version: 3,
      instrumentation: 'fixture',
      commit: head,
      tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
      modules: [probedModule(['test/total.test.ts'])],
    };
    await landRun(own, ran, worktree);

    expect(await readCommitRuns(own)).toMatchObject({
      commit: head,
      over: head,
      runs: 1,
      files: ['test/total.test.ts'],
      standing: [{ commit: head, files: ['test/other.test.ts'] }],
    });
    expect(await review(parseReview(['--root', worktree]))).toMatchObject({ from: head });
  });
});

describe('a fetched record this build does not read', () => {
  it('is passed over by every reader, for the primary checkout\'s, inside the ten minutes it would be reused', async () => {
    const { head, worktree } = await worktreeAtPublished();
    const kept = join(home, 'laptop-cache', 'share', 'read', 'unit', head, 'coverage.bin');
    await writeFile(kept, new Uint8Array([1, 2, 3, 4]));
    await git(worktree, 'remote', 'set-url', 'origin', join(home, 'nowhere.git'));
    const primary = testCoverageFile(join(home, 'clone'), { suite: 'unit' });

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ from: 'primary', file: primary });
    const own = testCoverageFile(worktree, { suite: 'unit' });
    expect(await seedTestCoverage(own, worktree)).not.toMatchObject({ from: 'mainline' });
    await rm(own, { force: true });
    await writeFile(join(worktree, 'src/total.ts'), 'export const changed = true;\n');
    const { err } = await selectedIn(worktree);
    expect(err).toContain(`record of "unit": read from the primary checkout's, at ${primary}`);
  });
});
