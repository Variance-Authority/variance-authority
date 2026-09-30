import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitRunsFile, type CommitRuns } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { runsBase } from './runs-base.js';

/**
 * Where a review of the runs starts, asked of git in the checkout it runs in.
 * `review.test.ts` holds the three answers as a review reads them; this holds
 * the ones only a clone can show, where git's "no" may or may not be an
 * answer, and the records refused before git is asked anything.
 */

/** Once set, reading a clone's shallow list fails as a file it may not open does. */
const denied = vi.hoisted(() => ({ shallow: false }));

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: (async (...args: Parameters<typeof actual.readFile>) => {
      if (denied.shallow && String(args[0]).endsWith('shallow')) {
        throw Object.assign(new Error(`EACCES: permission denied, open '${String(args[0])}'`), { code: 'EACCES' });
      }
      return actual.readFile(...args);
    }) as typeof actual.readFile,
  };
});

let made: string[] = [];
afterEach(async () => {
  denied.shallow = false;
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

  it('is refused after a "no" when the shallow list is there and cannot be read, which may hide a cut', async () => {
    const { origin, A, B } = await history();
    denied.shallow = true;

    const refused = runsBase(origin, runs(A, B), snapshot(origin));
    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toThrow('its shallow list could not be read: EACCES');
  });

  it('is none in a shallow clone when the walk between the two ends before the cut', async () => {
    // p0 … p5 on `main` and s on `side` from p4, cloned three deep: the cut is
    // at p3, below where s and p5 part, so the clone holds all of the answer.
    const origin = await mkdtemp(join(tmpdir(), 'variance-runs-base-line-'));
    const deeper = await mkdtemp(join(tmpdir(), 'variance-runs-base-deeper-'));
    made.push(origin, deeper);
    git(origin, 'init', '-q', '-b', 'main');
    const p: string[] = [];
    for (let n = 0; n <= 5; n += 1) {
      git(origin, 'commit', '-q', '--allow-empty', '-m', `p${n}`);
      p.push(git(origin, 'rev-parse', 'HEAD'));
    }
    git(origin, 'checkout', '-q', '-b', 'side', p[4]!);
    git(origin, 'commit', '-q', '--allow-empty', '-m', 's');
    const s = git(origin, 'rev-parse', 'HEAD');
    git(deeper, 'clone', '-q', '--depth', '3', '--no-single-branch', pathToFileURL(origin).href, '.');
    expect(git(deeper, 'rev-parse', '--is-shallow-repository')).toBe('true');
    expect(git(deeper, 'rev-list', p[5]!).split('\n')).toEqual([p[5], p[4], p[3]]);

    expect(await runsBase(deeper, runs(s, p[5]!), snapshot(deeper))).toBeUndefined();
  });

  it('asks about the checked-out commit when the record names no commit of its own', async () => {
    const { origin, A } = await history();
    expect(await runsBase(origin, runs(undefined, A), snapshot(origin))).toBe(A);
    // A commit off the checked-out line, which `HEAD` does not descend from.
    const off = git(origin, 'commit-tree', `${A}^{tree}`, '-p', A, '-m', 'off');
    expect(await runsBase(origin, runs(undefined, off), snapshot(origin))).toBeUndefined();

    const unknown = 'e'.repeat(40);
    const refused = runsBase(origin, runs(undefined, unknown), snapshot(origin));
    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toThrow(
      `the runs name no commit and were laid over ${unknown.slice(0, 12)}, and git cannot say whether the checked-out commit descends from it`,
    );
  });

  it('is their own commit when they were laid over it, as a first run at a snapshot already there is', async () => {
    const { origin, B } = await history();
    expect(await runsBase(origin, runs(B, B), snapshot(origin))).toBe(B);
  });

  it('refuses a record whose commits are not object names, before git reads them as options', async () => {
    const { origin, B } = await history();
    const refused = runsBase(origin, runs(B, '--all'), snapshot(origin));
    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toThrow(`\`${commitRunsFile(snapshot(origin))}\` is malformed: its \`over\` is "--all"`);

    await expect(runsBase(origin, runs('HEAD', B), snapshot(origin))).rejects.toThrow('its `commit` is "HEAD"');
    // Between the lengths of SHA-1 and SHA-256 names is neither.
    await expect(runsBase(origin, runs(B, 'a'.repeat(41)), snapshot(origin))).rejects.toThrow('which is not a commit\'s full object name');
  });

  it('is none when there is no record, or it names nothing it was laid over', async () => {
    const { origin, B } = await history();
    expect(await runsBase(origin, undefined, snapshot(origin))).toBeUndefined();
    expect(await runsBase(origin, { commit: B, first: '', latest: '', runs: 1, files: [] }, snapshot(origin))).toBeUndefined();
  });
});
