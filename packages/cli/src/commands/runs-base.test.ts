import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitRuns } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { runsBase } from './runs-base.js';

/**
 * Where a review of the runs starts, asked of git in the checkout it runs in.
 * `review.test.ts` holds the three answers as a review reads them; this holds
 * the one only a clone can show, where git's "no" is not an answer.
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

/** A → B on `main`, with `older` at A, and a clone of it one commit deep on every branch. */
async function history(): Promise<{ origin: string; shallow: string; A: string; B: string }> {
  const origin = await mkdtemp(join(tmpdir(), 'variance-runs-base-'));
  const shallow = await mkdtemp(join(tmpdir(), 'variance-runs-base-shallow-'));
  made.push(origin, shallow);
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'A');
  const A = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'branch', 'older');
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'B');
  const B = git(origin, 'rev-parse', 'HEAD');
  git(shallow, 'clone', '-q', '--depth', '1', '--no-single-branch', pathToFileURL(origin).href, '.');
  return { origin, shallow, A, B };
}

describe('where a review of the runs starts', () => {
  it('is the commit they were laid over when git says theirs descends from it', async () => {
    const { origin, A, B } = await history();
    expect(await runsBase(origin, runs(B, A))).toBe(A);
  });

  it('is none when git says it does not', async () => {
    const { origin, A, B } = await history();
    expect(await runsBase(origin, runs(A, B))).toBeUndefined();
  });

  it('is refused in a shallow clone, whose "no" only says the history was cut', async () => {
    const { shallow, A, B } = await history();
    // Both commits are here, and the one edge between them is not.
    expect(git(shallow, 'cat-file', '-t', A)).toBe('commit');

    const refused = runsBase(shallow, runs(B, A));
    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toThrow('this clone is shallow');
  });

  it('reads the record as it stands when it names no commit of its own to ask about', async () => {
    const { origin } = await history();
    expect(await runsBase(origin, runs(undefined, 'e'.repeat(40)))).toBe('e'.repeat(40));
    expect(await runsBase(origin, undefined)).toBeUndefined();
  });
});
