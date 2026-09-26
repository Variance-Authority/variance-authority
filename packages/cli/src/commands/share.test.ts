import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunReport } from '@variance-authority/report';
import type { Config } from '../config.js';
import type { Env } from '../share-lines.js';
import { mainlineIndex, mainlinesOf, publishedLine, publishRun, shareLines } from './share.js';

/**
 * A run publishes to the line it belongs to, and a reader reads its mainline.
 *
 * Against a real repository with a bare `origin`, because every answer here is
 * git's: which branch is the mainline, which commit descends from which, and
 * how far a record is from the checkout reading it.
 */

const run = promisify(execFile);

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-share-'));
  process.env['XDG_CACHE_HOME'] = join(home, 'cache');
});

afterEach(async () => {
  delete process.env['XDG_CACHE_HOME'];
  await rm(home, { recursive: true, force: true });
});

const PUSH: Env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };
const LOCAL: Env = {};

describe('which branches are mainlines', () => {
  it('is the config, then the branch the remote names, then the event, and never a guess', async () => {
    const repository = await repositoryOf(1);
    expect(await mainlinesOf(configOf({ root: home, mainlines: ['release', 'main'] }), LOCAL, repository.dir))
      .toEqual({ names: ['release', 'main'] });

    // A fetch by git 2.48 or later records the remote's HEAD itself; this one has none.
    await git(repository.dir, 'remote', 'set-head', 'origin', '--delete');

    expect(await mainlinesOf(configOf({}), LOCAL, repository.dir))
      .toEqual({ missing: ['config', 'remote-head', 'event'] });
    expect(await mainlinesOf(undefined, LOCAL, repository.dir))
      .toEqual({ missing: ['config', 'remote-head', 'event'] });

    const event = join(home, 'event.json');
    await writeFile(event, JSON.stringify({ repository: { default_branch: 'trunk' } }));
    expect(await mainlinesOf(configOf({}), { GITHUB_EVENT_PATH: event }, repository.dir)).toEqual({ names: ['trunk'] });

    await git(repository.dir, 'remote', 'set-head', 'origin', 'main');
    expect(await mainlinesOf(configOf({}), { GITHUB_EVENT_PATH: event }, repository.dir)).toEqual({ names: ['main'] });
  });
});

describe('publishing a run', () => {
  it('writes a push to the mainline, and a reader reads it back at its distance', async () => {
    const repository = await repositoryOf(3);
    const config = configOf({ root: join(home, 'share'), mainlines: ['main'] });

    const done = await publishRun(config, await reportAt(repository.commits[2]!), { env: PUSH, cwd: repository.dir });
    expect(done).toMatchObject({ line: { kind: 'mainline', name: 'main' }, published: { written: ['suite-index-v1'] } });

    await emptyLocalCache();
    const found = await mainlineIndex(config, { env: LOCAL, cwd: repository.dir });
    expect(found).toMatchObject({ mainline: 'main', commit: repository.commits[2], distance: 0, from: 'share' });
    expect('index' in found && found.index.subjects).toEqual(['page/footer']);

    // Kept on this machine, so the second read is a disk read.
    expect(await mainlineIndex(config, { env: LOCAL, cwd: repository.dir })).toMatchObject({ from: 'local' });
  });

  it('keeps a mainline record whose commit descends from the one offered', async () => {
    const repository = await repositoryOf(3);
    const config = configOf({ root: join(home, 'share'), mainlines: ['main'] });
    await publishRun(config, await reportAt(repository.commits[2]!), { env: PUSH, cwd: repository.dir });

    const late = await publishRun(config, await reportAt(repository.commits[1]!), { env: PUSH, cwd: repository.dir });
    expect(late).toMatchObject({
      published: { written: [], kept: [{ name: 'suite-index-v1', commit: repository.commits[2], because: 'newer-commit' }] },
    });
  });

  it('carries the report when the config gives it to the share', async () => {
    const repository = await repositoryOf(1);
    const config = { ...configOf({ root: join(home, 'share'), mainlines: ['main'] }), reportCarry: 'share' } as Config;

    const done = await publishRun(config, await reportAt(repository.commits[0]!), { env: PUSH, cwd: repository.dir });
    expect(done).toMatchObject({ published: { written: ['suite-index-v1', 'report-v1'] } });
  });

  it('writes a branch line from a pull request, with the head it pointed at', async () => {
    const repository = await repositoryOf(1);
    const config = configOf({ root: join(home, 'share'), mainlines: ['main'] });
    const event = join(home, 'event.json');
    const repo = { full_name: 'acme/web' };
    await writeFile(event, JSON.stringify({ pull_request: { head: { sha: 'abcd', repo }, base: { repo } } }));
    const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'feat/x', GITHUB_EVENT_PATH: event };

    const done = await publishRun(config, await reportAt(repository.commits[0]!), { env, cwd: repository.dir });
    expect(done).toMatchObject({ line: { kind: 'branch', name: 'feat/x' }, published: { written: ['suite-index-v1'] } });
    expect(await readdir(join(home, 'share', 'branch'))).not.toEqual([]);
  });

  it('publishes nothing from a merge queue, a fork, another event on a mainline, or a mainline checkout', async () => {
    const repository = await repositoryOf(1);
    const config = configOf({ root: join(home, 'share'), mainlines: ['main'] });
    const report = await reportAt(repository.commits[0]!);
    const event = join(home, 'event.json');
    await writeFile(event, JSON.stringify({
      pull_request: { head: { sha: 'abcd', repo: { full_name: 'someone/web' } }, base: { repo: { full_name: 'acme/web' } } },
    }));

    const outcomes = await Promise.all([
      { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'merge_group' },
      { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'x', GITHUB_EVENT_PATH: event },
      { ...PUSH, GITHUB_EVENT_NAME: 'schedule' },
      LOCAL,
    ].map((env) => publishRun(config, report, { env, cwd: repository.dir })));
    expect(outcomes.map((outcome) => 'none' in outcome)).toEqual([true, true, true, true]);
  });

  it('publishes nothing from a report that names no commit, and keeps nothing either', async () => {
    const report = join(home, 'run.json');
    await writeFile(report, JSON.stringify({ ...reportOf('3f1c'), run: undefined }));
    expect(await publishRun(configOf({ root: join(home, 'share') }), report, { env: PUSH, cwd: home }))
      .toEqual({ none: 'this report names no commit' });
  });
});

describe('what a run and `variance share` say', () => {
  it('a run keeps its index and publishes nothing', async () => {
    const line = await publishedLine(configOf({ root: join(home, 'share') }), reportOf('3f1c'));
    expect(line).toMatch(/^suite index: .*3f1c\.bin\n$/);
    expect(await publishedLine(configOf({}), { ...reportOf('3f1c'), run: undefined })).toBe('');
  });

  it('names the line a publish wrote, and the mainline a reader read', async () => {
    const repository = await repositoryOf(2);
    const root = join(home, 'share');
    const config = configOf({ root, mainlines: ['main'] });
    const report = await reportAt(repository.commits[0]!);

    expect(await shareLines(config, { publish: true, report }, { env: PUSH, cwd: repository.dir }))
      .toEqual([`wrote suite-index-v1 to mainline main in the directory ${root}.`]);

    const read = await shareLines(config, { publish: false }, { env: LOCAL, cwd: repository.dir });
    expect(read[0]).toBe(
      `mainline main evaluated at ${repository.commits[0]!}, 1 commit(s) behind the merge base with this checkout, read from this machine.`,
    );
    expect(read[1]).toBe('1 subject(s), 1 component(s), lexicon over 1 field(s) of 1 subject(s)');
  });

  it('says why a reader found nothing', async () => {
    const repository = await repositoryOf(1);
    await git(repository.dir, 'remote', 'set-head', 'origin', '--delete');
    expect(await shareLines(configOf({}), { publish: false }, { env: LOCAL, cwd: repository.dir }))
      .toEqual(['no mainline: nothing answered from config, remote-head, event.']);
    expect(await shareLines(configOf({}), { publish: false, mainline: 'main' }, { env: LOCAL, cwd: repository.dir }))
      .toEqual(['mainline main: no share is configured.']);
    expect(await shareLines(configOf({ root: join(home, 'share') }), { publish: false, mainline: 'main' }, { env: LOCAL, cwd: repository.dir }))
      .toEqual(['mainline main: nothing is published there.']);
  });
});

it.todo('`variance ask` in a checkout with no report answers from the branch record, then the mainline record, and names the commit it read — needs the report readers in `ask`, `serve` and the MCP tools to call `readLine` when the local report is absent');
it.todo('`variance review` and `variance select` take their base from the mainline record\'s `suite-v1` entry when this checkout recorded none, and say which they read — needs the base readers to read the mainline line before deriving a base');

describe('a git share', () => {
  it('authenticates with the header your clone sends its remote, as a checkout on CI does', async () => {
    const seen: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      seen.push(request.headers['authorization']);
      response.writeHead(403).end();
    });
    await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
    try {
      const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/acme/web.git`;
      const repository = await repositoryOf(1);
      await git(repository.dir, 'remote', 'set-url', 'origin', url);
      await git(repository.dir, 'config', `http.${url}.extraheader`, 'AUTHORIZATION: basic c2VjcmV0');
      const config = { project: 'web', report: join(home, 'report.json'), share: { kind: 'git', mainlines: ['main'] } } as Config;

      expect(await mainlineIndex(config, { env: LOCAL, cwd: repository.dir }))
        .toMatchObject({ mainline: 'main', miss: { kind: 'refused' } });
      expect(seen).toContain('basic c2VjcmV0');
    } finally {
      server.close();
    }
  });
});

async function emptyLocalCache(): Promise<void> {
  process.env['XDG_CACHE_HOME'] = await mkdtemp(join(home, 'cold-'));
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

/** A checkout of `main` with `commits` commits, all pushed to a bare `origin` and fetched back. */
async function repositoryOf(commits: number): Promise<{ dir: string; commits: string[] }> {
  const dir = await mkdtemp(join(home, 'repo-'));
  const origin = await mkdtemp(join(home, 'origin-'));
  await git(origin, 'init', '--bare', '--quiet');
  await git(dir, 'init', '--quiet', '-b', 'main');
  await git(dir, 'config', 'user.email', 'test@example.com');
  await git(dir, 'config', 'user.name', 'Test');
  await git(dir, 'remote', 'add', 'origin', origin);

  const made: string[] = [];
  for (let index = 0; index < commits; index += 1) {
    await git(dir, 'commit', '--quiet', '--allow-empty', '-m', `commit ${String(index)}`);
    made.push(await git(dir, 'rev-parse', 'HEAD'));
  }
  await git(dir, 'push', '--quiet', 'origin', 'main');
  await git(dir, 'fetch', '--quiet', 'origin');
  return { dir, commits: made };
}

function configOf(share: { root?: string; mainlines?: string[] }): Config {
  return {
    project: 'web',
    report: join(home, 'report.json'),
    ...(share.root === undefined
      ? {}
      : { share: { kind: 'directory', root: share.root, ...(share.mainlines ? { mainlines: share.mainlines } : {}) } }),
  } as Config;
}

async function reportAt(commit: string): Promise<string> {
  const path = join(home, `run-${commit}.json`);
  await writeFile(path, JSON.stringify(reportOf(commit)));
  return path;
}

function reportOf(commit: string): RunReport {
  return {
    runVersion: 1,
    observations: [],
    run: { id: 'run-1', commit },
    composition: {
      subjects: ['page/footer'],
      components: [{
        component: 'TodoFooter',
        subjects: ['page/footer'],
        instances: 1,
        examples: ['page/footer'],
        within: [],
        createdBy: [],
        renders: [],
        tokens: [],
        variants: 1,
        renderings: 1,
      }],
    },
    lexicon: {
      version: 1,
      fields: ['components'],
      subjects: [{ subject: 'page/footer', boundaries: 1, terms: { components: ['TodoFooter'] } }],
    },
  } as unknown as RunReport;
}
