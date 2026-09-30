import { mkdtemp, writeFile } from 'node:fs/promises';
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

  it('names the commit it was laid over whatever the history between the two, and asks git nothing', async () => {
    // `older` is a name, not a commit: nothing here is a checkout, and no
    // answer about ancestry is needed to write down what the snapshot stood at.
    const { root, coverageFile } = await recorded('newer');
    await writeFile(
      commitRunsFile(coverageFile),
      JSON.stringify({ commit: 'newer', over: 'elsewhere', first: '', latest: '', runs: 1, files: ['a.test.ts'], standing: [] }),
    );

    await landRun(coverageFile, run('older', ['b.test.ts']), root);

    expect(await readCommitRuns(coverageFile)).toMatchObject({
      commit: 'older',
      over: 'newer',
      standing: [{ commit: 'newer', files: ['a.test.ts'] }],
    });
  });

  it('carries where each test it did not run last ran, across partial runs at two commits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-'));
    const coverageFile = join(root, 'coverage.bin');
    const all = ['far.test.ts', 'near.test.ts', 'other.test.ts'];
    await writeTestCoverage(coverageFile, run('O', all));

    await landRun(coverageFile, run('P', all), root);
    expect(await readCommitRuns(coverageFile)).toMatchObject({ commit: 'P', over: 'O', files: all, standing: [] });

    await landRun(coverageFile, run('H', ['near.test.ts']), root);
    expect(await readCommitRuns(coverageFile)).toMatchObject({
      commit: 'H',
      over: 'P',
      standing: [{ commit: 'P', files: ['far.test.ts', 'other.test.ts'] }],
    });

    await landRun(coverageFile, run('C', ['other.test.ts']), root);
    expect(await readCommitRuns(coverageFile)).toMatchObject({
      commit: 'C',
      over: 'H',
      files: ['other.test.ts'],
      standing: [
        { commit: 'P', files: ['far.test.ts'] },
        { commit: 'H', files: ['near.test.ts'] },
      ],
    });

    // A retry at C keeps the order: `over` is H, and P is older than it.
    await landRun(coverageFile, run('C', ['other.test.ts']), root);
    expect((await readCommitRuns(coverageFile))?.standing).toEqual([
      { commit: 'P', files: ['far.test.ts'] },
      { commit: 'H', files: ['near.test.ts'] },
    ]);

    await landRun(coverageFile, run('C', ['far.test.ts']), root);
    expect(await readCommitRuns(coverageFile)).toMatchObject({
      commit: 'C',
      over: 'H',
      files: ['far.test.ts', 'other.test.ts'],
      standing: [{ commit: 'H', files: ['near.test.ts'] }],
    });
  });

  it('leaves `standing` absent, rather than guessed, when the record it replaces cannot say where a test last ran', async () => {
    const records = {
      'none beside the snapshot': undefined,
      'one written before `standing`': { commit: 'H', over: 'P', first: '', latest: '', runs: 1, files: ['a.test.ts'] },
      'one naming another commit': { commit: 'elsewhere', over: 'P', first: '', latest: '', runs: 1, files: ['a.test.ts'], standing: [] },
      'one that does not list a test': { commit: 'H', over: 'P', first: '', latest: '', runs: 1, files: ['a.test.ts'], standing: [] },
    };
    for (const [name, held] of Object.entries(records)) {
      const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-'));
      const coverageFile = join(root, 'coverage.bin');
      await writeTestCoverage(coverageFile, run('H', ['a.test.ts', 'b.test.ts']));
      if (held !== undefined) await writeFile(commitRunsFile(coverageFile), JSON.stringify(held));

      await landRun(coverageFile, run('C', ['c.test.ts']), root);
      expect((await readCommitRuns(coverageFile))?.standing, name).toBeUndefined();

      // The absence is carried until a run observes every test, which needs no record.
      await landRun(coverageFile, run('D', ['a.test.ts']), root);
      expect((await readCommitRuns(coverageFile))?.standing, name).toBeUndefined();
      await landRun(coverageFile, run('D', ['b.test.ts', 'c.test.ts']), root);
      expect((await readCommitRuns(coverageFile))?.standing, name).toEqual([]);
    }
  });

  it('lists no standing outside a checkout, where a run has no commit', async () => {
    const { root, coverageFile } = await recorded('base');

    await landRun(coverageFile, run(undefined, ['b.test.ts']), root);

    expect((await readCommitRuns(coverageFile))?.standing).toBeUndefined();
  });

  it('reads as absent where no run listed itself', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-'));

    expect(await readCommitRuns(join(root, 'coverage.bin'))).toBeUndefined();
  });
});
