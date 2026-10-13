import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { commentMarker } from '@variance-authority/cli';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The action's poster keeps one comment per project on a pull request.
 *
 * A repository that runs two gates, one config each, runs this twice on the
 * same pull request. Each run carries its own project's marker, so each finds
 * the comment it wrote and leaves the other's alone. A comment written before
 * the marker carried a project is still on open pull requests: with
 * `--adopt-unkeyed true` the poster takes the comment over instead of posting a
 * second one beside it, unless the run says it never wrote one.
 *
 * Driven as the action runs it, a process against a GitHub API, here a local
 * one that keeps the pull request's comments in memory.
 */

const ROOT = resolve(import.meta.dirname, '..');
const POSTER = join(ROOT, '.github/actions/variance/post-comment.mjs');
const OLD = '<!-- variance-authority: pr-docket v1 -->';
const TRIBUNAL = commentMarker('tribunal');
const STORYBOOK = commentMarker('storybook-case');

interface Comment {
  id: number;
  body: string;
}

interface Pull {
  comments: Comment[];
  calls: string[];
  url: string;
}

const made: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done));
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A GitHub that knows one pull request, number 7, and the comments on it. */
async function github(comments: Comment[] = []): Promise<Pull> {
  const pull: Pull = { comments, calls: [], url: '' };
  let next = 100;
  const server = createServer((request, response) => {
    let text = '';
    request.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      pull.calls.push(`${request.method} ${url.pathname}`);
      const reply = (status: number, payload?: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(payload === undefined ? undefined : JSON.stringify(payload));
      };
      if (request.method === 'GET' && url.pathname === '/repos/o/r/issues/7/comments') {
        const page = Number(url.searchParams.get('page') ?? '1');
        const size = Number(url.searchParams.get('per_page') ?? '30');
        return reply(200, pull.comments.slice((page - 1) * size, page * size));
      }
      if (request.method === 'POST' && url.pathname === '/repos/o/r/issues/7/comments') {
        const created = { id: next++, body: (JSON.parse(text) as { body: string }).body };
        pull.comments.push(created);
        return reply(201, created);
      }
      const patched = /^\/repos\/o\/r\/issues\/comments\/(\d+)$/.exec(url.pathname);
      const target = pull.comments.find((comment) => comment.id === Number(patched?.[1]));
      if (request.method === 'PATCH' && target !== undefined) {
        target.body = (JSON.parse(text) as { body: string }).body;
        return reply(200, target);
      }
      return reply(404, { message: 'Not Found' });
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  pull.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return pull;
}

async function poster(pull: Pull, body: string, args: readonly string[]): Promise<{ code: number | null; out: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'va-post-comment-'));
  made.push(dir);
  const file = join(dir, 'comment.md');
  await writeFile(file, body, 'utf8');
  const child = spawn('node', [POSTER, '--body-file', file, '--pr', '7', ...args], {
    cwd: ROOT,
    env: { PATH: process.env['PATH'], GITHUB_API_URL: pull.url, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'token' },
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
  return { code, out };
}

const docket = (marker: string, text: string) => `${marker}\n\n## Visual variance — ${text}\n`;

describe('post-comment', () => {
  it("keeps one comment for each project, and a rerun rewrites only its own project's", async () => {
    const pull = await github([{ id: 1, body: 'a reviewer said something' }]);

    await poster(pull, docket(TRIBUNAL, 'tribunal first'), ['--marker', TRIBUNAL, '--adopt-unkeyed', 'false']);
    await poster(pull, docket(STORYBOOK, 'storybook first'), ['--marker', STORYBOOK, '--adopt-unkeyed', 'false']);
    const rerun = await poster(pull, docket(TRIBUNAL, 'tribunal again'), ['--marker', TRIBUNAL, '--adopt-unkeyed', 'false']);

    expect(rerun.code).toBe(0);
    expect(pull.comments.map((comment) => comment.body)).toEqual([
      'a reviewer said something',
      docket(TRIBUNAL, 'tribunal again'),
      docket(STORYBOOK, 'storybook first'),
    ]);
  });

  it('takes over the comment written under the adopted marker rather than posting beside it', async () => {
    const pull = await github([{ id: 1, body: docket(OLD, 'from before the upgrade') }]);

    const { code } = await poster(pull, docket(STORYBOOK, 'after the upgrade'), [
      '--marker',
      STORYBOOK,
      '--adopt-unkeyed',
      'true',
    ]);

    expect(code).toBe(0);
    expect(pull.comments).toEqual([{ id: 1, body: docket(STORYBOOK, 'after the upgrade') }]);
    expect(pull.calls.filter((call) => call.startsWith('POST'))).toEqual([]);
  });

  it("clears an adopted comment under the project's own marker when the run is clean", async () => {
    const pull = await github([{ id: 1, body: docket(OLD, 'from before the upgrade') }]);

    await poster(pull, '', ['--marker', STORYBOOK, '--adopt-unkeyed', 'true']);

    expect(pull.comments).toHaveLength(1);
    expect(pull.comments[0]?.body.startsWith(`${STORYBOOK}\n`)).toBe(true);
    expect(pull.comments[0]?.body).not.toContain(OLD);
  });

  it("prefers its own project's comment to one it could adopt", async () => {
    const pull = await github([
      { id: 1, body: docket(OLD, 'from before the upgrade') },
      { id: 2, body: docket(STORYBOOK, 'already upgraded') },
    ]);

    await poster(pull, docket(STORYBOOK, 'rerun'), ['--marker', STORYBOOK, '--adopt-unkeyed', 'true']);

    expect(pull.comments).toEqual([
      { id: 1, body: docket(OLD, 'from before the upgrade') },
      { id: 2, body: docket(STORYBOOK, 'rerun') },
    ]);
  });

  it("leaves the unkeyed comment to the gate that wrote it when this one never did", async () => {
    // Only the gate that commented before the upgrade wrote the unkeyed docket;
    // a gate that comments for the first time and took it would replace that
    // gate's docket, or clear it on a clean run.
    const pull = await github([{ id: 1, body: docket(OLD, 'storybook, before the upgrade') }]);

    await poster(pull, '', ['--marker', TRIBUNAL, '--adopt-unkeyed', 'false']);
    await poster(pull, docket(TRIBUNAL, 'tribunal'), ['--marker', TRIBUNAL, '--adopt-unkeyed', 'false']);

    expect(pull.comments).toEqual([
      { id: 1, body: docket(OLD, 'storybook, before the upgrade') },
      { id: 100, body: docket(TRIBUNAL, 'tribunal') },
    ]);
  });

  it('takes its own comment on a later page over an unkeyed one on an earlier page', async () => {
    const chatter = Array.from({ length: 150 }, (_, index) => ({ id: index + 2, body: `comment ${index}` }));
    const pull = await github([{ id: 1, body: docket(OLD, 'from before the upgrade') }, ...chatter, { id: 999, body: docket(STORYBOOK, 'mine') }]);

    await poster(pull, docket(STORYBOOK, 'rerun'), ['--marker', STORYBOOK, '--adopt-unkeyed', 'true']);

    expect(pull.comments[0]).toEqual({ id: 1, body: docket(OLD, 'from before the upgrade') });
    expect(pull.comments.at(-1)).toEqual({ id: 999, body: docket(STORYBOOK, 'rerun') });
    expect(pull.calls.filter((call) => call.startsWith('GET'))).toHaveLength(2);
  });

  it('refuses to guess whether to adopt', async () => {
    const pull = await github();

    const { code, out } = await poster(pull, docket(TRIBUNAL, 'tribunal'), ['--marker', TRIBUNAL, '--adopt-unkeyed', 'yes']);

    expect(code).not.toBe(0);
    expect(out).toContain('--adopt-unkeyed');
    expect(pull.calls).toEqual([]);
  });
});
