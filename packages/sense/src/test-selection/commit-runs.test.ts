import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { commitRunsFile, landRun, readCommitRuns } from './commit-runs.js';
import { writeTestCoverage, type TestCoverage } from './index.js';

/** A run of `files` that instrumented one module: a run that instrumented none records no runs at all. */
function run(commit: string | undefined, files: readonly string[], instrumentation = 'fixture'): TestCoverage {
  return {
    version: 3,
    instrumentation,
    ...(commit === undefined ? {} : { commit }),
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [{
      file: 'src/a.ts',
      sourceDigest: 'source',
      instrumented: true,
      blocks: [{ ordinal: 0, kind: 'module', digest: 'root', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: [...files].sort() }],
    }],
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

  it('leaves `standing` absent, rather than guessed, when no record speaks for the snapshot it replaces', async () => {
    const records = {
      'none beside the snapshot': undefined,
      'one naming another commit': { commit: 'elsewhere', over: 'P', first: '', latest: '', runs: 1, files: ['a.test.ts'], standing: [] },
      'one with no start': { commit: 'H', first: '', latest: '', runs: 1, files: ['a.test.ts'], standing: [] },
    };
    for (const [name, held] of Object.entries(records)) {
      const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-'));
      const coverageFile = join(root, 'coverage.bin');
      await writeTestCoverage(coverageFile, run('H', ['a.test.ts', 'b.test.ts']));
      if (held !== undefined) await writeFile(commitRunsFile(coverageFile), JSON.stringify(held));

      await landRun(coverageFile, run('C', ['c.test.ts']), root);
      expect((await readCommitRuns(coverageFile))?.standing, name).toBeUndefined();

      // A run observing every test needs no record to say where each stands.
      await landRun(coverageFile, run('C', ['a.test.ts', 'b.test.ts']), root);
      expect((await readCommitRuns(coverageFile))?.standing, name).toEqual([]);
    }
  });

  it('lists a test the record it replaces cannot place at that record\'s start, as assumed', async () => {
    const records = {
      'one written before `standing`': { commit: 'H', over: 'P', first: '', latest: '', runs: 1, files: ['a.test.ts'] },
      'one that does not list a test': { commit: 'H', over: 'P', first: '', latest: '', runs: 1, files: ['a.test.ts'], standing: [] },
    };
    for (const [name, held] of Object.entries(records)) {
      const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-'));
      const coverageFile = join(root, 'coverage.bin');
      await writeTestCoverage(coverageFile, run('H', ['a.test.ts', 'b.test.ts']));
      await writeFile(commitRunsFile(coverageFile), JSON.stringify(held));

      await landRun(coverageFile, run('C', ['c.test.ts']), root);

      expect((await readCommitRuns(coverageFile))?.standing, name).toEqual([
        { commit: 'P', files: ['b.test.ts'], assumed: true },
        { commit: 'H', files: ['a.test.ts'] },
      ]);
    }
  });

  it('keeps an assumption where it was made when a later run moves `over`', async () => {
    // A worktree's record copied from its primary checkout at M2, laid over M1,
    // which never said where `b` ran.
    const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-'));
    const coverageFile = join(root, 'coverage.bin');
    await writeTestCoverage(coverageFile, run('M2', ['a.test.ts', 'b.test.ts']));
    await writeFile(
      commitRunsFile(coverageFile),
      JSON.stringify({ commit: 'M2', over: 'M1', first: '', latest: '', runs: 1, files: ['a.test.ts'] }),
    );

    await landRun(coverageFile, run('M3', ['c.test.ts']), root);
    await landRun(coverageFile, run('M4', ['a.test.ts']), root);

    expect(await readCommitRuns(coverageFile)).toMatchObject({
      commit: 'M4',
      over: 'M3',
      standing: [
        { commit: 'M1', files: ['b.test.ts'], assumed: true },
        { commit: 'M3', files: ['c.test.ts'] },
      ],
    });
  });

  it('lists a test at the commit it runs at when the test last ran there and this run did not', async () => {
    const { root, coverageFile } = await recorded('O');
    await landRun(coverageFile, run('P', ['a.test.ts', 'b.test.ts']), root);
    await landRun(coverageFile, run('Q', ['a.test.ts']), root);

    // Back at P, an older commit: `b` last ran on P's text, which is this one.
    await landRun(coverageFile, run('P', ['a.test.ts']), root);

    expect(await readCommitRuns(coverageFile)).toMatchObject({
      commit: 'P',
      over: 'Q',
      files: ['a.test.ts'],
      standing: [{ commit: 'P', files: ['b.test.ts'] }],
    });
  });

  it('reads no retried landing outside a checkout, where neither the snapshot nor the run names a commit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-'));
    const coverageFile = join(root, 'coverage.bin');
    await writeTestCoverage(coverageFile, run(undefined, ['a.test.ts']));
    await writeFile(
      commitRunsFile(coverageFile),
      JSON.stringify({ commit: 'H', over: 'P', first: '', latest: '', runs: 1, files: ['a.test.ts'], standing: [] }),
    );

    await landRun(coverageFile, run(undefined, ['b.test.ts']), root);

    const runs = await readCommitRuns(coverageFile);
    expect(runs).toMatchObject({ runs: 1, files: ['b.test.ts'] });
    expect(runs).not.toHaveProperty('over');
    expect(runs).not.toHaveProperty('commit');
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

  it('refuses a record that is there and is not a JSON object, naming the file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-'));
    const coverageFile = join(root, 'coverage.bin');

    await writeFile(commitRunsFile(coverageFile), '{"commit": ', 'utf8');
    await expect(readCommitRuns(coverageFile)).rejects.toThrow(`the runs record at ${commitRunsFile(coverageFile)} is not JSON`);
    await writeFile(commitRunsFile(coverageFile), '[]', 'utf8');
    await expect(readCommitRuns(coverageFile)).rejects.toThrow(`the runs record at ${commitRunsFile(coverageFile)} is not a JSON object`);
  });

  it('refuses a record that is there and cannot be read, rather than reading it as absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-'));
    const coverageFile = join(root, 'coverage.bin');

    await mkdir(commitRunsFile(coverageFile));
    await expect(readCommitRuns(coverageFile)).rejects.toThrow(`the runs record at ${commitRunsFile(coverageFile)} could not be read`);
  });

  it('writes a fresh record over one it cannot read, without `standing`, and says so', async () => {
    const { root, coverageFile } = await recorded('H');
    await writeTestCoverage(coverageFile, run('H', ['a.test.ts', 'b.test.ts']));
    await writeFile(commitRunsFile(coverageFile), '{"commit": ', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await landRun(coverageFile, run('C', ['a.test.ts']), root);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`the runs record at ${commitRunsFile(coverageFile)} is not JSON`));
    } finally {
      warn.mockRestore();
    }
    const written = await readCommitRuns(coverageFile);
    expect(written).toMatchObject({ commit: 'C', over: 'H', runs: 1, files: ['a.test.ts'] });
    expect(written?.standing).toBeUndefined();
  });

  it('lets a failure to write the record surface', async () => {
    const { root, coverageFile } = await recorded('H');
    await mkdir(commitRunsFile(coverageFile));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(landRun(coverageFile, run('C', ['a.test.ts']), root)).rejects.toThrow();
    } finally {
      warn.mockRestore();
    }
  });
});
