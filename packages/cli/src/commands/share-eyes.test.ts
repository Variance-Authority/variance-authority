import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunReport } from '@variance-authority/report';
import { commitRunsFile, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import type { Config } from '../config.js';
import type { Env } from '../share-lines.js';
import { shareLines } from './share.js';
import { suiteShare } from './suite-share.js';

/**
 * A record that kept Eyes journals leaves this machine only through a share,
 * and the share says that the journals went with it.
 *
 * Against a real repository, because the line a share writes to is git's answer.
 */

const run = promisify(execFile);
const PUSH: Env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };
const SAID = "suite-v1/unit carried its cases' Eyes journals: the record's eyes section went with it.";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-share-eyes-'));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'cache');
});

afterEach(async () => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

describe('a share of a record that kept Eyes journals', () => {
  it('names the journals among what `share --suite` uploads', async () => {
    const { dir } = await recorded({ eyes: true });
    const done = await suiteShare(dir, { suite: 'unit', publish: true, collected: join(home, 'collected.txt') }, { env: PUSH });
    expect(done.lines).toContain(SAID);
  });

  it('names them among what a run\'s share uploads', async () => {
    const { dir, commit } = await recorded({ eyes: true });
    const config = {
      project: 'web',
      report: join(home, 'report.json'),
      share: { kind: 'directory', root: join(home, 'share'), mainlines: ['main'] },
      suites: [{ name: 'unit', carry: 'share' }],
    } as unknown as Config;
    // A branch line publishes what a run touched, so it needs no list of what the runner collects.
    const lines = await shareLines(config, { publish: true, report: await reportAt(commit) }, { env: await pullRequest(commit), cwd: dir });
    expect(lines[0]).toContain('suite-v1/unit');
    expect(lines).toContain(SAID);
  });

  it('says nothing of Eyes for a record that kept none', async () => {
    const { dir } = await recorded({ eyes: false });
    const done = await suiteShare(dir, { suite: 'unit', publish: true, collected: join(home, 'collected.txt') }, { env: PUSH });
    expect(done.lines.join('\n')).not.toContain('Eyes');
    expect(done.lines[0]).toContain('wrote suite-v1/unit');
  });
});

/** A checkout at one pushed commit, holding a record of `unit` given to a directory share. */
async function recorded(options: { readonly eyes: boolean }): Promise<{ dir: string; commit: string }> {
  const dir = await mkdtemp(join(home, 'repo-'));
  const origin = await mkdtemp(join(home, 'origin-'));
  await git(origin, 'init', '--bare', '--quiet');
  await git(dir, 'init', '--quiet', '-b', 'main');
  await git(dir, 'config', 'user.email', 'test@example.com');
  await git(dir, 'config', 'user.name', 'Test');
  await git(dir, 'remote', 'add', 'origin', origin);
  await git(dir, 'commit', '--quiet', '--allow-empty', '-m', 'commit 0');
  const commit = await git(dir, 'rev-parse', 'HEAD');
  await git(dir, 'push', '--quiet', 'origin', 'main');
  await git(dir, 'fetch', '--quiet', 'origin');

  const share = { kind: 'directory', root: join(home, 'share'), mainlines: ['main'] };
  await writeFile(join(dir, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } }, share }));
  const record = testCoverageFile(dir, { suite: 'unit' });
  await mkdir(dirname(record), { recursive: true });
  const eyes = Buffer.from(`${JSON.stringify({ version: 1, journals: [] })}\n`);
  await writeTestCoverage(
    record,
    { version: 3, instrumentation: 'fixture', commit, tests: [], modules: [] },
    { index: Buffer.from('cases'), ...(options.eyes ? { eyes } : {}) },
  );
  await writeFile(commitRunsFile(record), JSON.stringify({ commit, first: '', latest: '', runs: 1, files: [], standing: [] }));
  await writeFile(join(home, 'collected.txt'), '');
  return { dir, commit };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

/** The environment of a pull request from `feat/x` whose head is `head`. */
async function pullRequest(head: string): Promise<Env> {
  const event = join(home, `event-${head}.json`);
  const repo = { full_name: 'acme/web' };
  await writeFile(event, JSON.stringify({ pull_request: { head: { sha: head, repo }, base: { repo } } }));
  return { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'feat/x', GITHUB_EVENT_PATH: event };
}

async function reportAt(commit: string): Promise<string> {
  const path = join(home, `run-${commit}.json`);
  await writeFile(path, JSON.stringify({
    runVersion: 1,
    identity: { renderer: 'playwright-chromium', engine: 'chromium@131', platform: 'linux/x64', deviceScaleFactor: 1, fonts: [] },
    observations: [],
    run: { id: 'run-1', commit },
    // A report publishes only with a suite index, which its composition gives.
    composition: {
      subjects: ['page/footer'],
      components: [{
        component: 'TodoFooter', subjects: ['page/footer'], instances: 1, examples: ['page/footer'],
        within: [], createdBy: [], renders: [], tokens: [], variants: 1, renderings: 1,
      }],
    },
    lexicon: {
      version: 1,
      fields: ['components'],
      subjects: [{ subject: 'page/footer', boundaries: 1, terms: { components: ['TodoFooter'] } }],
    },
  } as unknown as RunReport));
  return path;
}
