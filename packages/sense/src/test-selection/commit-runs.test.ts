import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitRunsFile, landRun, readCommitRuns } from './commit-runs.js';
import { writeTestCoverage, type TestCoverage } from './index.js';

function run(commit: string | undefined, files: readonly string[], instrumentation = 'fixture'): TestCoverage {
  return {
    version: 3,
    instrumentation,
    ...(commit === undefined ? {} : { commit }),
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [],
  };
}

async function recorded(at: string): Promise<{ root: string; coverageFile: string }> {
  const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-'));
  const coverageFile = join(root, 'coverage.bin');
  await writeTestCoverage(coverageFile, run(at, ['a.test.ts']));
  return { root, coverageFile };
}

describe('the runs recorded at one commit', () => {
  it('names the commit the snapshot was at before the first run at this one', async () => {
    const { root, coverageFile } = await recorded('base');

    await landRun(coverageFile, run('head', ['a.test.ts']), root);

    expect(commitRunsFile(coverageFile)).toBe(join(root, 'coverage.runs.json'));
    expect(await readCommitRuns(coverageFile)).toMatchObject({ commit: 'head', over: 'base', runs: 1, files: ['a.test.ts'] });
  });

  it('keeps that commit and adds the files when a shard or a retry runs at the same commit', async () => {
    const { root, coverageFile } = await recorded('base');

    await landRun(coverageFile, run('head', ['b.test.ts']), root);
    const first = await readCommitRuns(coverageFile);
    await landRun(coverageFile, run('head', ['a.test.ts']), root);

    expect(await readCommitRuns(coverageFile)).toMatchObject({
      commit: 'head',
      over: 'base',
      first: first!.first,
      runs: 2,
      files: ['a.test.ts', 'b.test.ts'],
    });
  });

  it('starts again at a new commit, laid over the last one', async () => {
    const { root, coverageFile } = await recorded('base');

    await landRun(coverageFile, run('head', ['a.test.ts']), root);
    await landRun(coverageFile, run('next', ['b.test.ts']), root);

    expect(await readCommitRuns(coverageFile)).toMatchObject({ commit: 'next', over: 'head', runs: 1, files: ['b.test.ts'] });
  });

  it('names no base when the snapshot before it was recorded by other instrumentation', async () => {
    const { root, coverageFile } = await recorded('base');

    await landRun(coverageFile, run('head', ['a.test.ts'], 'other'), root);

    expect((await readCommitRuns(coverageFile))?.over).toBeUndefined();
  });

  it('reads as absent where no run listed itself', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-'));

    expect(await readCommitRuns(join(root, 'coverage.bin'))).toBeUndefined();
  });
});
