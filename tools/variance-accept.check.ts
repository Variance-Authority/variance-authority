import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * What lands on `main` is `main`: every push to it promotes what it renders.
 *
 * A pull request is where a change is judged, and merging it is the person's
 * answer. Whatever its check said at the time — green, red, still running, or
 * never run because the check is new — the merge is what `main` now draws, and
 * a `main` that compared against anything else would hold every later pull
 * request to pixels nobody can see.
 *
 * Driven as the workflow runs it, a process against a GitHub API, here a local
 * one that answers what a repository with a history of unjudged and red commits
 * answers: each check's conclusion and each commit's parent, which the script
 * has no reason to read and promotes the same without.
 */

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, '.github/scripts/variance-accept.mjs');
const SHA = 'c'.repeat(40);
const PARENT = 'b'.repeat(40);
const HEAD = 'a'.repeat(40);

/** What the local GitHub answers about the pushed commit and its history. */
interface History {
  /** A merged pull request that brought the pushed commit in, if one did. */
  merged?: { number: number; title: string; as?: string };
  /** The check's conclusion on the pull request's head, `undefined` for none. */
  head?: string;
  /** The check's conclusion on `main` before the push, `undefined` for none. */
  parent?: string;
}

const made: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done));
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function github(history: History): Promise<string> {
  const runs = (conclusion: string | undefined) => ({
    check_runs:
      conclusion === undefined ? [] : [{ completed_at: '2026-10-13T00:00:00Z', conclusion }],
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const reply = (status: number, payload: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    const path = url.pathname;
    if (path === `/repos/o/r/commits/${SHA}/pulls`) {
      const { merged } = history;
      return reply(
        200,
        merged === undefined
          ? []
          : [
              {
                number: merged.number,
                title: merged.title,
                merged_at: '2026-10-13T00:00:00Z',
                merge_commit_sha: merged.as ?? SHA,
                head: { sha: HEAD },
              },
            ],
      );
    }
    if (path === `/repos/o/r/commits/${PARENT}/pulls`) return reply(200, []);
    if (path === `/repos/o/r/commits/${SHA}`) return reply(200, { parents: [{ sha: PARENT }] });
    if (path === `/repos/o/r/commits/${HEAD}/check-runs`) return reply(200, runs(history.head));
    if (path === `/repos/o/r/commits/${PARENT}/check-runs`) return reply(200, runs(history.parent));
    return reply(404, { message: 'Not Found' });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function decide(
  api: string,
  name: string,
  event: object,
  review?: string,
): Promise<{ code: number | null; out: string; outputs: Record<string, string> }> {
  const dir = await mkdtemp(join(tmpdir(), 'va-accept-'));
  made.push(dir);
  const eventPath = join(dir, 'event.json');
  const outputPath = join(dir, 'output');
  await writeFile(eventPath, JSON.stringify(event), 'utf8');
  await writeFile(outputPath, '', 'utf8');
  const child = spawn('node', [SCRIPT], {
    cwd: ROOT,
    env: {
      PATH: process.env['PATH'],
      GITHUB_API_URL: api,
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_TOKEN: 'token',
      GITHUB_SHA: SHA,
      GITHUB_EVENT_NAME: name,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: outputPath,
      GITHUB_REF_NAME: 'trunk',
      VARIANCE_ACCEPT_LABEL: 'variance: accept',
      ...(review === undefined ? {} : { VARIANCE_REVIEW: review }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
  });
  const code = await new Promise<number | null>((done) => child.on('close', done));
  const outputs: Record<string, string> = {};
  for (const [, key, value] of (await readFile(outputPath, 'utf8')).matchAll(
    /^([\w-]+)<<__variance__\n([\s\S]*?)\n__variance__$/gm,
  )) {
    outputs[key] = value;
  }
  return { code, out, outputs };
}

const pusher = { sender: { login: 'merger' } };
const pull = { number: 7, title: 'a change' };

describe('variance-accept', () => {
  it.each([
    ['a merge whose check never ran before it, because the check is new', { merged: pull, head: 'success' }, '#7'],
    ['a merge made before its check finished', { merged: pull, parent: 'success' }, '#7'],
    ['a merge whose check was red at its head', { merged: pull, head: 'failure', parent: 'success' }, '#7'],
    ['a merge onto a red `main`', { merged: pull, head: 'success', parent: 'failure' }, '#7'],
    ['a push that no pull request brought', { parent: 'success' }, '@merger'],
    ['a push a pull request brought but did not merge as', { merged: { ...pull, as: HEAD } }, '@merger'],
  ])('promotes what `main` renders after %s', async (_, history, named) => {
    const api = await github(history);

    const { code, out, outputs } = await decide(api, 'push', pusher);

    expect(code, out).toBe(0);
    expect(outputs['promote']).toBe('true');
    expect(outputs['because']).toContain(named);
    expect(outputs['because']).toContain('`trunk`');
  });

  it.each([
    ['git', 'true'],
    ['tribunal', 'false'],
  ])('promotes nothing on a push when the baselines are kept by %s', async (review, exitZeroOnChanges) => {
    const api = await github({ merged: pull });

    const { code, out, outputs } = await decide(api, 'push', pusher, review);

    expect(code, out).toBe(0);
    expect(outputs['promote']).toBe('false');
    // Under `git` the merge was the accept, and `main` has no branch to commit
    // what it renders to: a change it finds is a warning, not a red `main`.
    expect(outputs['exit-zero-on-changes']).toBe(exitZeroOnChanges);
  });

  it('compares only on a pull request event that is not the accept label', async () => {
    const api = await github({});

    const { code, out, outputs } = await decide(api, 'pull_request', {
      ...pusher,
      action: 'synchronize',
      pull_request: { number: 7, title: 'a change' },
    });

    expect(code, out).toBe(0);
    expect(outputs['promote']).toBe('false');
  });
});
