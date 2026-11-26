import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { caseSectionsOf, commitRunsFile, decodeTestCoverage, encodeTestCoverage, readCommitRuns, recordOfCases, withCaseSections, writeCommitRuns, type TestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordsFromQueue, restateRecord } from './from-queue.js';

const SHA = 'a'.repeat(40);
const ENV = { GITHUB_REPOSITORY: 'owner/repo', GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/check.yml@refs/heads/main' };

interface Call {
  readonly args: readonly string[];
}

/** A `gh` that lists `runs` for the commit and downloads one shard into `--dir`. */
function gh(runs: readonly object[], calls: Call[] = []) {
  return async (args: readonly string[]) => {
    calls.push({ args });
    if (args[0] === 'api') return { stdout: JSON.stringify({ workflow_runs: runs }) };
    const dir = args[args.indexOf('--dir') + 1]!;
    await mkdir(join(dir, 'variance-shard-1-0', 'suites', 'unit'), { recursive: true });
    await writeFile(join(dir, 'variance-shard-1-0', 'suites', 'unit', 'coverage.bin'), '');
    return { stdout: '' };
  };
}

const green = { id: 7, path: '.github/workflows/check.yml', status: 'completed', conclusion: 'success' };
/** What the pull request's run answers for a commit this checkout does not hold, so no merge of a head. */
const NO_MERGE = "aaaaaaaaaaaa is not a merge, so no pull request's run tested its change";

describe('recordsFromQueue', () => {
  it("downloads the shards of this workflow's green merge-queue run at the commit", async () => {
    const calls: Call[] = [];
    const got = await recordsFromQueue({ root: '.', pattern: 'variance-shard-*', commit: SHA, env: ENV }, gh([green], calls));

    expect(calls[0]).toEqual({ args: ['api', `repos/owner/repo/actions/runs?head_sha=${SHA}&event=merge_group&per_page=100`] });
    expect(calls[1]).toEqual({ args: ['run', 'download', '7', '--repo', 'owner/repo', '--pattern', 'variance-shard-*', '--dir', expect.any(String)] });
    if (!('dir' in got)) throw new Error(got.none);
    expect(await readdir(got.dir)).toEqual(['variance-shard-1-0']);
  });

  it('takes the latest green run when the queue ran the commit more than once', async () => {
    const calls: Call[] = [];
    await recordsFromQueue({ root: '.', pattern: 'p', commit: SHA, env: ENV }, gh([green, { ...green, id: 9 }, { ...green, id: 8 }], calls));

    expect(calls[1]?.args[2]).toBe('9');
  });

  it.each([
    ['another workflow', { ...green, path: '.github/workflows/other.yml' }],
    ['a run that failed', { ...green, conclusion: 'failure' }],
    ['a run still going', { ...green, status: 'in_progress', conclusion: null }],
  ])('refuses %s, and downloads nothing', async (_, run) => {
    const calls: Call[] = [];
    const got = await recordsFromQueue({ root: '.', pattern: 'p', commit: SHA, env: ENV }, gh([run], calls));

    expect(got).toEqual({ none: `no green merge-queue run of .github/workflows/check.yml tested ${SHA}; ${NO_MERGE}` });
    expect(calls).toHaveLength(1);
  });

  it('refuses outside a GitHub Actions run, which names the repository and the workflow', async () => {
    const got = await recordsFromQueue({ root: '.', pattern: 'p', commit: SHA, env: {} }, gh([green]));

    expect(got).toEqual({ none: '`--from-queue` reads the merge queue of the workflow running it, and GITHUB_REPOSITORY and GITHUB_WORKFLOW_REF are not set' });
  });

  it('refuses a run that kept no shard by the pattern', async () => {
    const got = await recordsFromQueue({ root: '.', pattern: 'p', commit: SHA, env: ENV }, async (args) => {
      if (args[0] === 'api') return { stdout: JSON.stringify({ workflow_runs: [green] }) };
      throw Object.assign(new Error('failed'), { stderr: 'no valid artifacts found to download' });
    });

    expect(got).toEqual({ none: `run 7 kept no artifact named p: \`gh run download 7\` failed: no valid artifacts found to download; ${NO_MERGE}` });
  });

  it('fails naming gh when it cannot list the runs, since a push with no answer must be seen', async () => {
    const missing = recordsFromQueue({ root: '.', pattern: 'p', commit: SHA, env: ENV }, async () => {
      throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    });

    await expect(missing).rejects.toThrow('--from-queue downloads the artifact with the GitHub CLI, `gh`, and `gh` is not on the PATH.');
  });
});

describe("recordsFromQueue, when the merge queue kept no run, reading the pull request's", () => {
  let home: string | undefined;
  afterEach(async () => {
    if (home !== undefined) await rm(home, { recursive: true, force: true });
  });

  /** A checkout whose `main` landed a head merged into `first`, its tree changed after the merge when `drifted`. */
  async function landed(drifted = false): Promise<{ root: string; commit: string; head: string }> {
    home = await realpath(await mkdtemp(join(tmpdir(), 'variance-from-head-')));
    const git = async (...args: string[]) => (await promisify(execFile)('git', args, { cwd: home })).stdout.trim();
    await git('init', '--quiet', '-b', 'main');
    await git('config', 'user.name', 'fixture');
    await git('config', 'user.email', 'fixture@example.com');
    await writeFile(join(home, 'a.ts'), 'export const a = 1;\n');
    await git('add', '-A');
    await git('commit', '--quiet', '-m', 'first');
    await git('checkout', '--quiet', '-b', 'feat');
    await writeFile(join(home, 'b.ts'), 'export const b = 1;\n');
    await git('add', '-A');
    await git('commit', '--quiet', '-m', 'head');
    await git('checkout', '--quiet', 'main');
    await git('merge', '--quiet', '--no-ff', '-m', 'land', 'feat');
    if (drifted) {
      await writeFile(join(home, 'c.ts'), 'export const c = 1;\n');
      await git('add', '-A');
      await git('commit', '--quiet', '--amend', '-m', 'land');
    }
    return { root: home, commit: await git('rev-parse', 'HEAD'), head: await git('rev-parse', 'HEAD^2') };
  }

  /** A `gh` whose merge queue kept no run, whose pull request runs at the head are `runs`, and whose download fails. */
  function pullRequestRuns(runs: readonly object[], calls: Call[] = []) {
    return async (args: readonly string[]) => {
      calls.push({ args });
      if (args[0] === 'api') return { stdout: JSON.stringify({ workflow_runs: args[1]!.includes('event=pull_request') ? runs : [] }) };
      throw Object.assign(new Error('failed'), { stderr: 'no valid artifacts found to download' });
    };
  }

  const queueless = (commit: string) => `no green merge-queue run of .github/workflows/check.yml tested ${commit}`;

  it('refuses when no green pull request run tested the head, and downloads nothing', async () => {
    const { root, commit, head } = await landed();
    const calls: Call[] = [];

    const got = await recordsFromQueue({ root, pattern: 'p', commit, env: ENV }, pullRequestRuns([{ ...green, conclusion: 'failure' }], calls));

    expect(got).toEqual({ none: `${queueless(commit)}; no green pull_request run of .github/workflows/check.yml tested its head ${head.slice(0, 12)}` });
    expect(calls.map(({ args }) => args[0])).toEqual(['api', 'api']);
  });

  it("refuses when the head merged with the landed merge's first parent is not the tree that landed, and downloads nothing", async () => {
    const { root, commit, head } = await landed(true);
    const calls: Call[] = [];

    const got = await recordsFromQueue({ root, pattern: 'p', commit, env: ENV }, pullRequestRuns([green], calls));

    expect(got).toEqual({ none: `${queueless(commit)}; ${head.slice(0, 12)} merged with ${(await parentOf(root, commit)).slice(0, 12)} is not the tree ${commit.slice(0, 12)} landed, so run 7 tested another change` });
    expect(calls.map(({ args }) => args[0])).toEqual(['api', 'api']);
  });

  it('refuses when the pull request run kept no shard by the pattern', async () => {
    const { root, commit } = await landed();

    const got = await recordsFromQueue({ root, pattern: 'p', commit, env: ENV }, pullRequestRuns([green]));

    expect(got).toEqual({ none: `${queueless(commit)}; run 7 kept no artifact named p: \`gh run download 7\` failed: no valid artifacts found to download` });
  });

  it('refuses, and removes what it downloaded, when the pull request run kept artifacts that hold no record', async () => {
    const { root, commit, head } = await landed();
    let into: string | undefined;
    const emptyArtifact = async (args: readonly string[]) => {
      if (args[0] === 'api') return { stdout: JSON.stringify({ workflow_runs: args[1]!.includes('event=pull_request') ? [green] : [] }) };
      into = args[args.indexOf('--dir') + 1]!;
      await mkdir(join(into, 'variance-shard-unit-1'), { recursive: true });
      await writeFile(join(into, 'variance-shard-unit-1', 'notes.txt'), 'no record here\n');
      return { stdout: '' };
    };

    const got = await recordsFromQueue({ root, pattern: 'p', commit, env: ENV }, emptyArtifact);

    expect(got).toEqual({ none: `${queueless(commit)}; run 7 did not test ${head.slice(0, 12)} merged with ${(await parentOf(root, commit)).slice(0, 12)}: its artifacts hold no record` });
    await expect(stat(into!)).rejects.toThrow('ENOENT');
  });
});

async function parentOf(root: string, commit: string): Promise<string> {
  return (await promisify(execFile)('git', ['rev-parse', `${commit}^1`], { cwd: root })).stdout.trim();
}

const MERGE = 'a'.repeat(40);
const LANDED = 'b'.repeat(40);
const BEFORE = 'c'.repeat(40);

/** A record a pull request's run made at its merge, standing one test at an earlier commit. */
const coverage: TestCoverage = {
  version: 3,
  instrumentation: 'fixture',
  commit: MERGE,
  tests: [{ file: 'test/ran.test.ts', complete: true, preconditions: [] }],
  modules: [{
    file: 'src/ran.ts', sourceDigest: 'ran', instrumented: true,
    blocks: [{ ordinal: 0, kind: 'module', digest: 'digest-ran', name: 'ran', path: 'ran', source: true, startLine: 1, endLine: 1, testFiles: ['test/ran.test.ts'] }],
  }],
};
const last = { commit: MERGE, before: BEFORE, at: '2026-11-12T21:13:48.631Z', files: ['test/ran.test.ts'], cases: [] };

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'variance-restate-'));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function recorded(): Promise<string> {
  const file = join(scratch, 'coverage.bin');
  await writeFile(file, withCaseSections(encodeTestCoverage(coverage), { last: Buffer.from(JSON.stringify(last)) }));
  await writeCommitRuns(commitRunsFile(file), {
    commit: MERGE,
    latest: last.at,
    runs: 1,
    landings: [],
    standing: [{ commit: BEFORE, files: ['test/other.test.ts'] }, { commit: MERGE, files: ['test/again.test.ts'] }],
  });
  return file;
}

describe('restateRecord', () => {
  it('names the landed commit wherever the record named the merge, and keeps what it observed and every other commit', async () => {
    const file = await recorded();

    expect(await restateRecord(file, MERGE, LANDED)).toEqual({ restated: true });

    const bytes = await readFile(file);
    expect(decodeTestCoverage(bytes)).toEqual({ ...coverage, commit: LANDED });
    expect(JSON.parse(Buffer.from(caseSectionsOf(bytes).last!).toString('utf8'))).toEqual({ ...last, commit: LANDED });
    const runs = await readCommitRuns(file);
    expect(runs?.commit).toBe(LANDED);
    expect(runs?.standing).toEqual([{ commit: BEFORE, files: ['test/other.test.ts'] }, { commit: LANDED, files: ['test/again.test.ts'] }]);
  });

  it('leaves a record made at another commit as it is, and names that commit', async () => {
    const file = await recorded();
    const bytes = await readFile(file);
    const runs = await readFile(commitRunsFile(file));

    expect(await restateRecord(file, BEFORE, LANDED)).toEqual({ madeAt: MERGE });

    expect(await readFile(file)).toEqual(bytes);
    expect(await readFile(commitRunsFile(file))).toEqual(runs);
  });

  it('restates a record of cases without coverage by the commit its last run names, the only one it holds', async () => {
    const file = join(scratch, 'coverage.bin');
    await writeFile(file, recordOfCases({ last: Buffer.from(JSON.stringify(last)) }));

    expect(await restateRecord(file, MERGE, LANDED)).toEqual({ restated: true });

    expect(JSON.parse(Buffer.from(caseSectionsOf(await readFile(file)).last!).toString('utf8'))).toEqual({ ...last, commit: LANDED });
  });

  it('leaves a record of cases without coverage whose last run names another commit as it is', async () => {
    const file = join(scratch, 'coverage.bin');
    const bytes = recordOfCases({ last: Buffer.from(JSON.stringify(last)) });
    await writeFile(file, bytes);

    expect(await restateRecord(file, BEFORE, LANDED)).toEqual({ madeAt: MERGE });
    expect(await readFile(file)).toEqual(bytes);
  });
});
