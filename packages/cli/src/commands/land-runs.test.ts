import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitRunsFile,
  landRun,
  readCommitRuns,
  writeTestCoverage,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { landJourneys } from './land.js';

/**
 * The runs record a landing leaves beside the snapshot it lands on.
 *
 * A fold of shards is one run of the suite at the shards' commit, so it is
 * recorded by the rules a runner's `landRun` records a run by. The record
 * before it is laid down here by the real `landRun`, and the fold by the real
 * landing, so the two writers are held to one rule by what they wrote.
 */

let home: string;
let into: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-land-runs-')));
  into = join(home, 'coverage.bin');
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const ALL = ['far.test.ts', 'near.test.ts', 'other.test.ts'];

function run(commit: string, files: readonly string[], instrumentation = 'fixture'): TestCoverage {
  return {
    version: 3,
    instrumentation,
    commit,
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [],
  };
}

/** Land `runs` as shards, one snapshot each, over the snapshot at `into`. */
async function land(...runs: TestCoverage[]): Promise<void> {
  const shards = await Promise.all(
    runs.map(async (shard, index) => {
      const path = join(home, `shard-${index}.bin`);
      await writeTestCoverage(path, shard);
      return path;
    }),
  );
  await landJourneys(home, shards, into);
}

/** P ran every test, then H ran `near` alone. */
async function partial(): Promise<void> {
  await landRun(into, run('P', ALL), home);
  await landRun(into, run('H', ['near.test.ts']), home);
}

describe('a landing records its fold as one run at the shards\' commit', () => {
  it('at a new commit, names the commit the snapshot stood at and carries where every other test last ran', async () => {
    await partial();

    await land(run('C', ['other.test.ts']));

    expect(await readCommitRuns(into)).toMatchObject({
      commit: 'C',
      over: 'H',
      runs: 1,
      files: ['other.test.ts'],
      standing: [
        { commit: 'P', files: ['far.test.ts'] },
        { commit: 'H', files: ['near.test.ts'] },
      ],
    });
  });

  it('at the commit the record already names, is one more run there: the files join and the base is kept', async () => {
    await partial();
    const before = await readCommitRuns(into);

    await land(run('H', ['other.test.ts']));

    expect(await readCommitRuns(into)).toEqual({
      commit: 'H',
      over: 'P',
      first: before!.first,
      latest: expect.any(String),
      runs: 2,
      files: ['near.test.ts', 'other.test.ts'],
      standing: [{ commit: 'P', files: ['far.test.ts'] }],
    });
  });

  it('leaves `standing` absent when no record says where the tests it did not run last ran', async () => {
    await partial();
    await rm(commitRunsFile(into));

    await land(run('C', ['other.test.ts']));

    const runs = await readCommitRuns(into);
    expect(runs).toMatchObject({ commit: 'C', over: 'H', files: ['other.test.ts'] });
    expect(runs).not.toHaveProperty('standing');
  });

  it('says every test stands where it ran when the shards between them ran every test', async () => {
    await partial();

    await land(run('C', ['far.test.ts', 'near.test.ts']), run('C', ['other.test.ts']));

    expect(await readCommitRuns(into)).toMatchObject({ commit: 'C', over: 'H', files: ALL, standing: [] });
  });

  it('names no base when the snapshot it replaces was recorded by other probes', async () => {
    await partial();

    await land(run('C', ['other.test.ts'], 'other probes'));

    const runs = await readCommitRuns(into);
    expect(runs).toMatchObject({ commit: 'C', files: ['other.test.ts'], standing: [] });
    expect(runs).not.toHaveProperty('over');
  });

  it('names no base when the shards\' commit does not descend from the snapshot\'s, as git says', async () => {
    const git = (...args: string[]): string =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: home, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'A');
    const A = git('rev-parse', 'HEAD');
    git('commit', '-q', '--allow-empty', '-m', 'L');
    const L = git('rev-parse', 'HEAD');
    // The local runs are at L; the main line's shards, fetched, are at A.
    await landRun(into, run(L, ALL), home);

    await land(run(A, ['other.test.ts']));

    const runs = await readCommitRuns(into);
    expect(runs).toMatchObject({ commit: A, files: ['other.test.ts'], standing: [{ commit: L, files: ['far.test.ts', 'near.test.ts'] }] });
    expect(runs).not.toHaveProperty('over');

    // And a fold that does descend from the snapshot's commit names it.
    await land(run(L, ['other.test.ts']));
    expect(await readCommitRuns(into)).toMatchObject({ commit: L, over: A });
  });

  it('refuses a runs record it cannot read, naming it, and lands nothing', async () => {
    await partial();
    await writeFile(commitRunsFile(into), '{ not json');
    const snapshot = await readFile(into);

    const landing = land(run('C', ['other.test.ts']));

    await expect(landing).rejects.toBeInstanceOf(OperatorError);
    await expect(landing).rejects.toThrow(`the runs record at ${commitRunsFile(into)} could not be read`);
    expect(await readFile(into)).toEqual(snapshot);
    expect(await readFile(commitRunsFile(into), 'utf8')).toBe('{ not json');
  });

  it('leaves no staged file beside the snapshot or the record', async () => {
    await partial();

    await land(run('C', ['other.test.ts']));

    expect((await readdir(home)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
