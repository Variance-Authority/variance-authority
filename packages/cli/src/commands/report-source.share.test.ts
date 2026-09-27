import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import type { Env } from '../share-lines.js';
import { ask, type AskRequest } from './ask.js';
import { reportsFor } from './report-read.js';
import { publishRun } from './share.js';

/**
 * Where `ask` keeps a report it read from a line, and which line it reads.
 *
 * Against a real repository with a bare `origin`, as `share.test.ts` is, but
 * with the configured report inside that repository, where a checkout keeps
 * it: the kept copy repeats that path under its digest, so image paths the
 * report names relative to itself open where they would in the checkout.
 */

const run = promisify(execFile);

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-report-share-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const PUSH: Env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };
const LOCAL: Env = {};
const KEPT = /kept at (.+)\.\n/;

describe('a report read from a line', () => {
  it('is kept at its path in the repository, so an image directory beside the report\'s directory opens', async () => {
    const repository = await repositoryOf();
    const config = configOf(repository, { kind: 'directory', root: join(home, 'share'), mainlines: ['main'] });
    const ci = join(home, 'ci');
    await mkdir(join(ci, '.variance'), { recursive: true });
    await mkdir(join(ci, 'artifacts'), { recursive: true });
    await writeFile(join(ci, 'artifacts', 'footer.png'), 'pixels');
    await writeFile(join(ci, '.variance', 'report.json'), JSON.stringify(reportOf(repository.commit, { after: '../artifacts/footer.png' })));
    await publishRun(config, join(ci, '.variance', 'report.json'), { env: PUSH, cwd: repository.dir });

    const answer = await asked(config, repository.dir, LOCAL, { question: 'describe', subject: 'page/footer' });
    expect(answer).not.toContain('image ../artifacts/footer.png');
    const kept = KEPT.exec(answer)![1]!;
    expect(kept).toMatch(/\/report\/[0-9a-f]{64}\/\.variance\/report\.json$/);
    expect(await readFile(join(kept, '..', '..', 'artifacts', 'footer.png'), 'utf8')).toBe('pixels');
  });

  it('is read again from where it was kept, and the share is not asked for its bytes', async () => {
    const repository = await repositoryOf();
    const root = join(home, 'share');
    const config = configOf(repository, { kind: 'directory', root, mainlines: ['main'] });
    await publishRun(config, await reportAt(repository.commit), { env: PUSH, cwd: repository.dir });

    const kept = KEPT.exec(await asked(config, repository.dir))![1]!;
    await rm(join(root, 'mainline', 'main', 'entries'), { recursive: true });
    expect(KEPT.exec(await asked(config, repository.dir))![1]).toBe(kept);
  });

  it('is kept at one path whichever directory you ask from', async () => {
    const repository = await repositoryOf();
    const config = configOf(repository, { kind: 'directory', root: join(home, 'share'), mainlines: ['main'] });
    await publishRun(config, await reportAt(repository.commit), { env: PUSH, cwd: repository.dir });
    const nested = join(repository.dir, 'packages', 'app');
    await mkdir(nested, { recursive: true });

    const kept = KEPT.exec(await asked(config, repository.dir))![1]!;

    expect(kept).toMatch(/\/report\/[0-9a-f]{64}\/\.variance\/report\.json$/);
    expect(KEPT.exec(await asked(config, nested))![1]).toBe(kept);
    expect(KEPT.exec(await asked(config, home))![1]).toBe(kept);
  });

  it('is the mainline\'s for a pull request from a fork, even when a branch of the same name is published', async () => {
    const repository = await repositoryOf();
    const config = configOf(repository, { kind: 'directory', root: join(home, 'share'), mainlines: ['main'] });
    await publishRun(config, await reportAt(repository.commit), { env: PUSH, cwd: repository.dir });
    const ours = await pullRequest('acme/web', repository.commit);
    expect(await publishRun(config, await reportAt(repository.commit), { env: ours, cwd: repository.dir }))
      .toMatchObject({ line: { kind: 'branch', name: 'patch-1' } });

    const fork = await pullRequest('someone/web', repository.commit);
    const answer = await asked(config, repository.dir, fork);
    expect(answer).toMatch(/^report: read from mainline main, /);
    expect(answer).not.toContain('patch-1');
    // The same-repository pull request still reads its own branch.
    expect(await asked(config, repository.dir, ours)).toMatch(/^report: read from branch patch-1, /);
  });
});

describe('a share that refuses the reader', () => {
  it('is said beside the mainline answer when only the branch is refused, and lists every line when all are', async () => {
    const repository = await repositoryOf();
    const root = join(home, 'share');
    await publishRun(configOf(repository, { kind: 'directory', root, mainlines: ['main'] }), await reportAt(repository.commit), {
      env: PUSH,
      cwd: repository.dir,
    });
    await git(repository.dir, 'checkout', '--quiet', '-b', 'feat/x');

    let refuse = (url: string): boolean => url.startsWith('/branch/');
    const server = createServer((request, response) => {
      const url = request.url ?? '/';
      if (refuse(url)) return void response.writeHead(403).end();
      readFile(join(root, decodeURIComponent(url))).then(
        (bytes) => response.writeHead(200).end(bytes),
        () => response.writeHead(404).end(),
      );
    });
    await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
    try {
      const endpoint = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      const config = configOf(repository, { kind: 'http', endpoint, mainlines: ['main'] });

      const answer = await asked(config, repository.dir);
      expect(answer.split('\n').slice(0, 3)).toEqual([
        expect.stringMatching(new RegExp(`^report: read from mainline main, evaluated at ${repository.commit}, .*; kept at .+\\.$`)),
        `branch feat/x: ${endpoint}/branch/feat/x/manifest.json: HTTP 403.`,
        '',
      ]);

      refuse = () => true;
      await rm(join(home, 'cache'), { recursive: true, force: true });
      await expect(asked(config, repository.dir)).rejects.toThrow(
        `there is no run report at ${config.report}, which is where \`report\` in your configuration points, ` +
          'and the share holds none for this checkout:\n' +
          `  branch feat/x: ${endpoint}/branch/feat/x/manifest.json: HTTP 403\n` +
          `  mainline main: ${endpoint}/mainline/main/manifest.json: HTTP 403`,
      );
    } finally {
      server.close();
    }
  });
});

/** A question asked the way `dispatch` asks it: the configured report, read through `reportsFor`. */
async function asked(config: Config, cwd: string, env: Env = LOCAL, rest: Partial<AskRequest> = {}): Promise<string> {
  return ask({ question: 'summary', report: config.report, read: () => reportsFor([], config), here: { env, cwd }, ...rest });
}

/** The configured report where a checkout keeps it, `.variance/report.json`, and a cache of the test's own. */
function configOf(repository: { readonly dir: string }, share: Record<string, unknown>): Config {
  return {
    project: 'web',
    report: join(repository.dir, '.variance', 'report.json'),
    reportCarry: 'share',
    cacheRoot: join(home, 'cache'),
    share,
  } as unknown as Config;
}

/** The environment of a pull request from `patch-1` in `head` to `acme/web`. */
async function pullRequest(head: string, sha: string): Promise<Env> {
  const event = join(home, `event-${head.replace('/', '-')}.json`);
  await writeFile(event, JSON.stringify({ pull_request: { head: { sha, repo: { full_name: head } }, base: { repo: { full_name: 'acme/web' } } } }));
  return { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'patch-1', GITHUB_EVENT_PATH: event };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

/** A checkout of `main` with one commit, pushed to a bare `origin` and fetched back. */
async function repositoryOf(): Promise<{ dir: string; commit: string }> {
  const dir = await mkdtemp(join(home, 'repo-'));
  const origin = await mkdtemp(join(home, 'origin-'));
  await git(origin, 'init', '--bare', '--quiet');
  await git(dir, 'init', '--quiet', '-b', 'main');
  await git(dir, 'config', 'user.email', 'test@example.com');
  await git(dir, 'config', 'user.name', 'Test');
  await git(dir, 'remote', 'add', 'origin', origin);
  await git(dir, 'commit', '--quiet', '--allow-empty', '-m', 'one');
  await git(dir, 'push', '--quiet', 'origin', 'main');
  await git(dir, 'fetch', '--quiet', 'origin');
  return { dir, commit: await git(dir, 'rev-parse', 'HEAD') };
}

async function reportAt(commit: string): Promise<string> {
  const path = join(home, `run-${commit}-${String(Date.now())}.json`);
  await writeFile(path, JSON.stringify(reportOf(commit)));
  return path;
}

function reportOf(commit: string, images?: Record<string, string>): unknown {
  return {
    runVersion: 1,
    identity: { renderer: 'playwright-chromium', engine: 'chromium@131', platform: 'linux/x64', deviceScaleFactor: 1, fonts: [] },
    observations: images === undefined
      ? []
      : [{ subject: 'page/footer', verdict: 'changed', because: 'it changed', changedPixels: 1, regions: [], images }],
    run: { id: 'run-1', commit },
    composition: { subjects: ['page/footer'], components: [] },
  };
}
