import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordsFromQueue } from './from-queue.js';

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

    expect(got).toEqual({ none: `no green merge-queue run of .github/workflows/check.yml tested ${SHA}` });
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

    expect(got).toEqual({ none: 'run 7 kept no artifact named p: `gh run download 7` failed: no valid artifacts found to download' });
  });

  it('fails naming gh when it cannot list the runs, since a push with no answer must be seen', async () => {
    const missing = recordsFromQueue({ root: '.', pattern: 'p', commit: SHA, env: ENV }, async () => {
      throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    });

    await expect(missing).rejects.toThrow('--from-queue downloads the artifact with the GitHub CLI, `gh`, and `gh` is not on the PATH.');
  });
});
