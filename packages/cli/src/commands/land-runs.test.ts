import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitRunsFile,
  landRun,
  readCommitRuns,
  readTestCoverage,
  writeTestCoverage,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { landJourneys } from './land.js';
import { probedModule } from './mainline-fixture.js';

/**
 * The runs record a landing leaves beside the snapshot it lands on.
 *
 * A fold of shards is one run of the suite at the shards' commit, so it is
 * recorded by the rules a runner's `landRun` records a run by. The record
 * before it is laid down here by the real `landRun`, and the fold by the real
 * landing, so the two writers are held to one rule by what they wrote.
 */

/** Once set, the landing's last rename, of its runs record over the one beside the snapshot, fails. */
const interrupted = vi.hoisted(() => ({ runs: false }));

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (interrupted.runs && String(args[1]).endsWith('.runs.json')) {
        throw Object.assign(new Error('EIO: i/o error, rename'), { code: 'EIO' });
      }
      return actual.rename(...args);
    },
  };
});

let home: string;
let into: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-land-runs-')));
  into = join(home, 'coverage.bin');
});

afterEach(async () => {
  interrupted.runs = false;
  await rm(home, { recursive: true, force: true });
});

const ALL = ['far.test.ts', 'near.test.ts', 'other.test.ts'];

/** A run of `files` that instrumented one module: `landRun` records no runs for a run that instrumented none. */
function run(commit: string, files: readonly string[], instrumentation = 'fixture'): TestCoverage {
  return {
    version: 3,
    instrumentation,
    commit,
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [probedModule(files)],
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

  it('names the commit it was laid over as it stands, from a root that is not a checkout', async () => {
    // `home` is outside any repository, as a landing with `--into` from a CI
    // job's scratch directory is: nobody here could say which commit is older.
    expect(() => execFileSync('git', ['rev-parse', '--git-dir'], { cwd: home, stdio: 'ignore' })).toThrow();
    const local = 'a'.repeat(40);
    const fetched = 'b'.repeat(40);
    await landRun(into, run(local, ALL), home);

    await land(run(fetched, ['other.test.ts']));

    expect(await readCommitRuns(into)).toMatchObject({
      commit: fetched,
      over: local,
      files: ['other.test.ts'],
      standing: [{ commit: local, files: ['far.test.ts', 'near.test.ts'] }],
    });
  });

  it('writes a runs record it cannot read afresh, as a runner does, and says so naming it', async () => {
    await partial();
    await writeFile(commitRunsFile(into), '{ not json');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let said: string;
    try {
      await land(run('C', ['other.test.ts']));
    } finally {
      said = stderr.mock.calls.map(([line]) => String(line)).join('');
      stderr.mockRestore();
    }

    expect((await readTestCoverage(into)).commit).toBe('C');
    const runs = await readCommitRuns(into);
    expect(runs).toMatchObject({ commit: 'C', over: 'H', files: ['other.test.ts'] });
    expect(runs).not.toHaveProperty('standing');
    expect(said).toContain(
      `variance: the runs record at ${commitRunsFile(into)} is not JSON`,
    );
  });

  it('landed again after the record was not renamed, names the commit the interrupted landing was laid over, and where each test stood there', async () => {
    await partial();
    interrupted.runs = true;
    await expect(land(run('C', ['other.test.ts']))).rejects.toThrow('EIO');
    // The snapshot landed and the record beside it is still the one before.
    expect((await readTestCoverage(into)).commit).toBe('C');
    expect(await readCommitRuns(into)).toMatchObject({ commit: 'H', over: 'P' });
    interrupted.runs = false;

    await land(run('C', ['other.test.ts']));

    // The record the interrupted landing left still says where each test
    // stood over H, and the retry carries it as a landing that finished would.
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

  it('leaves no staged file beside the snapshot or the record', async () => {
    await partial();

    await land(run('C', ['other.test.ts']));

    expect((await readdir(home)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
