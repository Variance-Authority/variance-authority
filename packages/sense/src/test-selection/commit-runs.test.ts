import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { commitRunsAfter, commitRunsFile, landRun, readCommitRuns, type CommitRuns } from './commit-runs.js';
import { writeTestCoverage, type TestCoverage } from './index.js';
import { whatLanded } from './landings.js';

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

/** The test files the runs record at `coverageFile` says its landings finished. */
async function landedAt(coverageFile: string): Promise<readonly string[] | undefined> {
  const runs = await readCommitRuns(coverageFile);
  return runs === undefined ? undefined : whatLanded(runs.landings).files;
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
    expect(await readCommitRuns(coverageFile)).toMatchObject({ commit: 'head', over: 'base', runs: 1 });
    expect(await landedAt(coverageFile)).toEqual(['a.test.ts']);
  });

  it('keeps that commit and adds the files when a shard or a retry runs at the same commit', async () => {
    const { root, coverageFile } = await recorded('base');

    await landRun(coverageFile, run('head', ['b.test.ts']), root);
    const first = await readCommitRuns(coverageFile);
    await landRun(coverageFile, run('head', ['a.test.ts']), root);

    expect(await readCommitRuns(coverageFile)).toMatchObject({ commit: 'head', over: 'base', runs: 2, landings: [first!.landings[0], {}] });
    expect(await landedAt(coverageFile)).toEqual(['a.test.ts', 'b.test.ts']);
  });

  it('names none of the cases of a held file it ran in part when the run kept no cases', async () => {
    // A run that kept no cases leaves the index as it was: every case of the
    // file it holds is the earlier run's, and the landing says this one laid none.
    const { root, coverageFile } = await recorded('base');
    await landRun(coverageFile, run('head', ['a.test.ts']), root);
    const partial = run('head', ['a.test.ts', 'b.test.ts']);

    await landRun(coverageFile, { ...partial, tests: partial.tests.map((test) => ({ ...test, complete: test.file !== 'a.test.ts' })) }, root);

    expect((await readCommitRuns(coverageFile))?.landings.at(-1)).toMatchObject({ files: ['b.test.ts'], partly: ['a.test.ts'], cases: { 'a.test.ts': [] } });
  });

  it('starts again at a new commit, laid over the last one', async () => {
    const { root, coverageFile } = await recorded('base');

    await landRun(coverageFile, run('head', ['a.test.ts']), root);
    await landRun(coverageFile, run('next', ['b.test.ts']), root);

    expect(await readCommitRuns(coverageFile)).toMatchObject({ commit: 'next', over: 'head', runs: 1 });
    expect(await landedAt(coverageFile)).toEqual(['b.test.ts']);
  });

  it('refuses a run recorded by other instrumentation over the snapshot, and names no base', async () => {
    // One build records under one set of probes: a snapshot under another is
    // another build's, and the run is refused rather than laid over nothing.
    const { root, coverageFile } = await recorded('base');

    await expect(landRun(coverageFile, run('head', ['a.test.ts'], 'other'), root))
      .rejects.toThrow(/probes `fixture` and the run under `other`/);
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
    expect(await readCommitRuns(coverageFile)).toMatchObject({ commit: 'P', over: 'O', standing: [] });
    expect(await landedAt(coverageFile)).toEqual(all);

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
      standing: [
        { commit: 'P', files: ['far.test.ts'] },
        { commit: 'H', files: ['near.test.ts'] },
      ],
    });
    expect(await landedAt(coverageFile)).toEqual(['other.test.ts']);

    // A retry at C keeps the order: `over` is H, and P is older than it.
    await landRun(coverageFile, run('C', ['other.test.ts']), root);
    expect((await readCommitRuns(coverageFile))?.standing).toMatchObject([
      { commit: 'P', files: ['far.test.ts'] },
      { commit: 'H', files: ['near.test.ts'] },
    ]);

    await landRun(coverageFile, run('C', ['far.test.ts']), root);
    expect(await readCommitRuns(coverageFile)).toMatchObject({
      commit: 'C',
      over: 'H',
      standing: [{ commit: 'H', files: ['near.test.ts'] }],
    });
    expect(await landedAt(coverageFile)).toEqual(['far.test.ts', 'other.test.ts']);
  });

  it('carries when the runs at a commit landed with the tests a run at another commit moves off it', () => {
    // When a test last ran is when its run landed. The runs record holds that
    // for the runs at its own commit; a run at the next commit moves the tests
    // it did not run into `standing`, and the time goes with them, as their
    // install does. Nothing works it out again from the commit.
    const tests = (...files: string[]) => files.map((file) => ({ file, complete: true }));
    const atP: CommitRuns = {
      commit: 'P',
      over: 'O',
      latest: '2026-01-02T00:00:00.000Z',
      runs: 2,
      standing: [],
      landings: [{ files: ['a.test.ts', 'b.test.ts', 'c.test.ts'], first: '2026-01-01T00:00:00.000Z', latest: '2026-01-02T00:00:00.000Z', runs: 2 }],
    };
    const atH = commitRunsAfter({ instrumentation: 'fixture', commit: 'P', tests: tests('a.test.ts', 'b.test.ts', 'c.test.ts') }, atP, {
      instrumentation: 'fixture',
      commit: 'H',
      tests: tests('a.test.ts'),
    });
    const ranAtP = { first: '2026-01-01T00:00:00.000Z', latest: '2026-01-02T00:00:00.000Z', runs: 2 };
    expect(atH.standing).toEqual([{ commit: 'P', files: ['b.test.ts', 'c.test.ts'], ...ranAtP }]);

    const atC = commitRunsAfter({ instrumentation: 'fixture', commit: 'H', tests: tests('a.test.ts', 'b.test.ts', 'c.test.ts') }, atH, {
      instrumentation: 'fixture',
      commit: 'C',
      tests: tests('c.test.ts'),
    });
    expect(atC.standing).toEqual([
      { commit: 'P', files: ['b.test.ts'], ...ranAtP },
      { commit: 'H', files: ['a.test.ts'], first: atH.landings[0]!.first, latest: atH.latest, runs: 1 },
    ]);
  });

  it('keeps each run at a commit apart when the runs there land again', () => {
    // Runs at P, then at Q, then at P again: the test only the first runs at P
    // ran stands at P beside the ones the later runs there ran, each at the
    // time of the run that ran it, which the other's never spans.
    const tests = (...files: string[]) => files.map((file) => ({ file, complete: true }));
    const held: CommitRuns = {
      commit: 'P',
      over: 'Q',
      latest: '2026-01-03T00:00:00.000Z',
      runs: 1,
      standing: [{ commit: 'P', files: ['b.test.ts'], first: '2026-01-01T00:00:00.000Z', latest: '2026-01-01T00:00:00.000Z', runs: 1 }],
      landings: [{ files: ['a.test.ts'], first: '2026-01-03T00:00:00.000Z', latest: '2026-01-03T00:00:00.000Z', runs: 1 }],
    };
    const after = commitRunsAfter({ instrumentation: 'fixture', commit: 'P', tests: tests('a.test.ts', 'b.test.ts', 'c.test.ts') }, held, {
      instrumentation: 'fixture',
      commit: 'R',
      tests: tests('c.test.ts'),
    });
    expect(after.standing).toEqual([
      { commit: 'P', files: ['b.test.ts'], first: '2026-01-01T00:00:00.000Z', latest: '2026-01-01T00:00:00.000Z', runs: 1 },
      { commit: 'P', files: ['a.test.ts'], first: '2026-01-03T00:00:00.000Z', latest: '2026-01-03T00:00:00.000Z', runs: 1 },
    ]);
  });

  it('holds no time for a stand written without one, and the runs that land at its commit again keep theirs', () => {
    // A stand that does not say when its tests ran is not dated by the runs
    // that land at its commit later: those are other runs.
    const tests = (...files: string[]) => files.map((file) => ({ file, complete: true }));
    const held: CommitRuns = {
      commit: 'P',
      over: 'Q',
      latest: '2026-01-03T00:00:00.000Z',
      runs: 1,
      standing: [{ commit: 'P', files: ['b.test.ts'] }],
      landings: [{ files: ['a.test.ts'], first: '2026-01-03T00:00:00.000Z', latest: '2026-01-03T00:00:00.000Z', runs: 1 }],
    };
    const after = commitRunsAfter({ instrumentation: 'fixture', commit: 'P', tests: tests('a.test.ts', 'b.test.ts', 'c.test.ts') }, held, {
      instrumentation: 'fixture',
      commit: 'R',
      tests: tests('c.test.ts'),
    });
    expect(after.standing).toEqual([
      { commit: 'P', files: ['b.test.ts'] },
      { commit: 'P', files: ['a.test.ts'], first: '2026-01-03T00:00:00.000Z', latest: '2026-01-03T00:00:00.000Z', runs: 1 },
    ]);
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
        { commit: 'H', files: ['a.test.ts'], first: '', latest: '', runs: 1 },
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
      standing: [{ commit: 'P', files: ['b.test.ts'] }],
    });
    expect(await landedAt(coverageFile)).toEqual(['a.test.ts']);
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
    expect(runs).toMatchObject({ runs: 1 });
    expect(await landedAt(coverageFile)).toEqual(['b.test.ts']);
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
    expect(written).toMatchObject({ commit: 'C', over: 'H', runs: 1 });
    expect(await landedAt(coverageFile)).toEqual(['a.test.ts']);
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

describe('what the runs record stores', () => {
  const DAY1 = '2026-01-01T00:00:00.000Z';
  const DAY2 = '2026-01-02T00:00:00.000Z';
  const DAY3 = '2026-01-03T00:00:00.000Z';
  it('reads a record written before landings as one landing of its envelope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-'));
    const coverageFile = join(root, 'coverage.bin');
    const standing = [{ commit: 'O', files: ['c.test.ts'] }];
    const records = {
      'two runs': [
        { commit: 'P', over: 'O', first: DAY1, latest: DAY2, runs: 2, files: ['a.test.ts', 'b.test.ts'], standing, installed: {} },
        { commit: 'P', over: 'O', latest: DAY2, runs: 2, standing, landings: [{ files: ['a.test.ts', 'b.test.ts'], first: DAY1, latest: DAY2, runs: 2, installed: {} }] },
      ],
      // A seed was stamped when it was seeded, so its time says nothing of its tests.
      'a seed': [
        { commit: 'P', first: DAY3, latest: DAY3, runs: 0, files: ['a.test.ts'] },
        { commit: 'P', latest: DAY3, runs: 0, landings: [{ files: ['a.test.ts'] }] },
      ],
      'no files': [
        { commit: 'P', first: DAY3, latest: DAY3, runs: 1, files: [], installed: {} },
        { commit: 'P', latest: DAY3, runs: 1, landings: [] },
      ],
    };
    for (const [name, [written, read]] of Object.entries(records)) {
      await writeFile(commitRunsFile(coverageFile), JSON.stringify(written));
      expect(await readCommitRuns(coverageFile), name).toEqual(read);
    }
  });

  it('writes no list of files or install over a record written before landings, and keeps its landing first', async () => {
    const { root, coverageFile } = await recorded('P');
    await writeFile(
      commitRunsFile(coverageFile),
      JSON.stringify({ commit: 'P', over: 'O', first: DAY1, latest: DAY2, runs: 2, files: ['a.test.ts'], standing: [], installed: {} }),
    );

    await landRun(coverageFile, run('P', ['b.test.ts']), root);

    const written = JSON.parse(await readFile(commitRunsFile(coverageFile), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(['commit', 'landings', 'latest', 'over', 'runs', 'standing']);
    expect(written).toMatchObject({ commit: 'P', over: 'O', runs: 3, landings: [{ files: ['a.test.ts'], first: DAY1, latest: DAY2, runs: 2, installed: {} }, { files: ['b.test.ts'] }] });
  });

  it('refuses a record whose landings or stands do not say what they are, naming the file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-'));
    const coverageFile = join(root, 'coverage.bin');
    const named = `the runs record at ${commitRunsFile(coverageFile)}`;
    const records = {
      [`${named} holds \`landings\` that is not a list`]: { commit: 'P', latest: DAY1, runs: 1, landings: {} },
      [`${named} holds a landing with no list of the test files it finished`]: { commit: 'P', latest: DAY1, runs: 1, landings: [{ first: DAY1 }] },
      [`${named} has no list of the test files that ran at its commit`]: { commit: 'P', latest: DAY1, runs: 1 },
      [`${named} holds a \`standing\` that is not a list`]: { commit: 'P', latest: DAY1, runs: 1, landings: [], standing: {} },
      [`${named} holds a \`standing\` entry with no list of test files`]: { commit: 'P', latest: DAY1, runs: 1, landings: [], standing: [{ commit: 'O' }] },
      [`${named} holds a \`standing\` entry that names no commit`]: { commit: 'P', latest: DAY1, runs: 1, landings: [], standing: [{ files: [] }] },
    };
    for (const [refusal, record] of Object.entries(records)) {
      await writeFile(commitRunsFile(coverageFile), JSON.stringify(record));
      await expect(readCommitRuns(coverageFile)).rejects.toThrow(refusal);
    }
  });
});
