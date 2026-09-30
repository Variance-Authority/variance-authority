import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { commitRunsFile, type CommitRuns } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { runsBase } from './runs-base.js';

/**
 * Where a review of the runs starts, asked of git in the checkout it runs in.
 * `review.test.ts` holds the three answers as a review reads them; this holds
 * the ones only a clone can show, where git's "no" may or may not be an
 * answer, and the records refused before git is asked anything.
 */

let made: string[] = [];
afterEach(async () => {
  await Promise.all(made.map((at) => rm(at, { recursive: true, force: true })));
  made = [];
});

const git = (at: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd: at,
    stdio: 'pipe',
    encoding: 'utf8',
  }).trim();

const runs = (commit: string | undefined, over: string): CommitRuns => ({
  ...(commit === undefined ? {} : { commit }),
  over,
  first: '',
  latest: '',
  runs: 1,
  files: [],
});

/** root → A → B on `main`, with `older` at A, and a clone of it one commit deep on every branch. */
async function history(): Promise<{ origin: string; shallow: string; A: string; B: string }> {
  const origin = await mkdtemp(join(tmpdir(), 'variance-runs-base-'));
  const shallow = await mkdtemp(join(tmpdir(), 'variance-runs-base-shallow-'));
  made.push(origin, shallow);
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'root');
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'A');
  const A = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'branch', 'older');
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'B');
  const B = git(origin, 'rev-parse', 'HEAD');
  git(shallow, 'clone', '-q', '--depth', '1', '--no-single-branch', pathToFileURL(origin).href, '.');
  return { origin, shallow, A, B };
}

/** The snapshot a record sits beside, which a refusal names through its record. */
const snapshot = (root: string): string => join(root, 'coverage.bin');

describe('where a review of the runs starts', () => {
  it('is the commit they were laid over when git says theirs descends from it', async () => {
    const { origin, A, B } = await history();
    expect(await runsBase(origin, runs(B, A), snapshot(origin))).toBe(A);
  });

  it('is none when git says it does not', async () => {
    const { origin, A, B } = await history();
    expect(await runsBase(origin, runs(A, B), snapshot(origin))).toBeUndefined();
  });

  it('is refused in a shallow clone when the walk between the two reaches the cut', async () => {
    const { shallow, A, B } = await history();
    // Both commits are here, and the one edge between them is not.
    expect(git(shallow, 'cat-file', '-t', A)).toBe('commit');

    const refused = runsBase(shallow, runs(B, A), snapshot(shallow));
    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toThrow('this clone is shallow, and its history between them stops at the cut');
  });

  it('is none in a shallow clone when the walk between the two ends before the cut', async () => {
    const { origin, A, B } = await history();
    // C on a side branch from A, cloned two deep: the cut is at A, which B reaches.
    git(origin, 'checkout', '-q', '-b', 'side', A);
    git(origin, 'commit', '-q', '--allow-empty', '-m', 'C');
    const C = git(origin, 'rev-parse', 'HEAD');
    const deeper = await mkdtemp(join(tmpdir(), 'variance-runs-base-deeper-'));
    made.push(deeper);
    git(deeper, 'clone', '-q', '--depth', '2', '--no-single-branch', pathToFileURL(origin).href, '.');
    expect(git(deeper, 'rev-parse', '--is-shallow-repository')).toBe('true');

    expect(await runsBase(deeper, runs(C, B), snapshot(deeper))).toBeUndefined();
  });

  it('asks about the checked-out commit when the record names no commit of its own', async () => {
    const { origin, A } = await history();
    expect(await runsBase(origin, runs(undefined, A), snapshot(origin))).toBe(A);

    const unknown = 'e'.repeat(40);
    const refused = runsBase(origin, runs(undefined, unknown), snapshot(origin));
    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toThrow(
      `the runs name no commit and were laid over ${unknown.slice(0, 12)}, and git cannot say whether the checked-out commit descends from it`,
    );
  });

  it('is refused when the runs were laid over their own commit, as a retried interrupted landing leaves them', async () => {
    const { origin, B } = await history();
    const refused = runsBase(origin, runs(B, B), snapshot(origin));
    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toThrow(`\`${commitRunsFile(snapshot(origin))}\` says the runs at ${B.slice(0, 12)} were laid over that same commit`);
    await expect(refused).rejects.toThrow('a landing interrupted between writing the snapshot and this record');
    await expect(refused).rejects.toThrow('`--since <ref>`');
  });

  it('refuses a record whose commits are not object names, before git reads them as options', async () => {
    const { origin, B } = await history();
    const refused = runsBase(origin, runs(B, '--all'), snapshot(origin));
    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toThrow(`\`${commitRunsFile(snapshot(origin))}\` is malformed: its \`over\` is "--all"`);

    await expect(runsBase(origin, runs('HEAD', B), snapshot(origin))).rejects.toThrow('its `commit` is "HEAD"');
  });

  it('is none when there is no record, or it names nothing it was laid over', async () => {
    const { origin, B } = await history();
    expect(await runsBase(origin, undefined, snapshot(origin))).toBeUndefined();
    expect(await runsBase(origin, { commit: B, first: '', latest: '', runs: 1, files: [] }, snapshot(origin))).toBeUndefined();
  });
});
