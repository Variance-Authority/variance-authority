import { execFile, spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { suiteEntry } from '../share-entries.js';
import { PUSH, collectedBoth, gitPublished } from './mainline-fixture.js';
import { publishSuite } from './suite-share.js';

/**
 * `variance share --publish` from a CI step that holds a token and a clone
 * that does not: the step's `GITHUB_TOKEN` reaches the remote, and no file.
 *
 * Against git's own HTTP server, `git http-backend`, behind a gate that
 * refuses any request without the header, because whether the push gets
 * through is git's answer, not ours.
 */

const run = promisify(execFile);
let home: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-share-token-')));
  for (const name of ['GITHUB_TOKEN', 'GITHUB_SERVER_URL', 'GIT_CONFIG_COUNT']) vi.stubEnv(name, undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const TOKEN = 'ghs_stepsOwnToken';
const basic = (token: string) => `basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;

describe('a publish step that holds a token', () => {
  it('reaches a remote that asks for it with `GITHUB_TOKEN` alone in its environment, and writes it to no file', async () => {
    const { ci, origin } = await gitPublished(home, { publish: false });
    await served(origin, basic(TOKEN), async (url, server) => {
      await git(ci, 'remote', 'set-url', 'origin', url);
      vi.stubEnv('GITHUB_SERVER_URL', server);
      vi.stubEnv('GITHUB_TOKEN', TOKEN);

      expect(await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) }))
        .toMatchObject({ published: { written: [suiteEntry('unit')] } });
    });
    expect(await git(home, 'ls-remote', origin, 'refs/variance/mainline/main')).toMatch(/refs\/variance\/mainline\/main$/u);
    expect(await filesHolding(home, [TOKEN, basic(TOKEN).slice('basic '.length)])).toEqual([]);
  });

  it('sends the header the clone or the step already gives git, once, rather than one of its own', async () => {
    const { ci, origin } = await gitPublished(home, { publish: false });
    const seen: number[] = [];
    await served(origin, basic('ghs_clones'), async (url, server) => {
      await git(ci, 'remote', 'set-url', 'origin', url);
      await git(ci, 'config', `http.${url}.extraheader`, `AUTHORIZATION: ${basic('ghs_clones')}`);
      vi.stubEnv('GITHUB_SERVER_URL', server);
      vi.stubEnv('GITHUB_TOKEN', TOKEN);

      expect(await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) }))
        .toMatchObject({ published: { written: [suiteEntry('unit')] } });
    }, seen);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([1]));
  });

  it('gives the token to no host but the one the CI host names', async () => {
    const { ci, origin } = await gitPublished(home, { publish: false });
    const seen: number[] = [];
    await served(origin, basic(TOKEN), async (url) => {
      await git(ci, 'remote', 'set-url', 'origin', url);
      vi.stubEnv('GITHUB_SERVER_URL', 'https://github.com');
      vi.stubEnv('GITHUB_TOKEN', TOKEN);

      expect(await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) }))
        .not.toMatchObject({ published: { written: [suiteEntry('unit')] } });
    }, seen);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([0]));
  });
});

/**
 * `bare` served over HTTP by `git http-backend`, refusing with 403 every
 * request whose `Authorization` is not `header`, while `body` runs. `seen`
 * takes how many `Authorization` headers each request carried.
 */
async function served(
  bare: string,
  header: string,
  body: (url: string, server: string) => Promise<void>,
  seen: number[] = [],
): Promise<void> {
  const server = createServer((request, response) => {
    const given = request.rawHeaders.filter((_, at) => at % 2 === 0 && request.rawHeaders[at]?.toLowerCase() === 'authorization');
    seen.push(given.length);
    if (given.length !== 1 || request.headers['authorization'] !== header) {
      response.writeHead(403).end();
      return;
    }
    backend(dirname(bare), request, response);
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  const at = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  try {
    await body(`${at}/${basename(bare)}`, at);
  } finally {
    server.close();
  }
}

/** One request answered by `git http-backend` as a CGI script over `root`. */
function backend(root: string, request: IncomingMessage, response: ServerResponse): void {
  const [path = '', query = ''] = (request.url ?? '').split('?');
  const child = spawn('git', ['http-backend'], {
    env: {
      PATH: process.env['PATH'],
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.receivepack',
      GIT_CONFIG_VALUE_0: 'true',
      PATH_INFO: path,
      QUERY_STRING: query,
      REQUEST_METHOD: request.method ?? 'GET',
      CONTENT_TYPE: request.headers['content-type'] ?? '',
      HTTP_CONTENT_ENCODING: request.headers['content-encoding'] ?? '',
      GIT_PROTOCOL: request.headers['git-protocol'] ?? '',
    },
  });
  request.pipe(child.stdin);
  const out: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
  child.on('close', () => {
    const all = Buffer.concat(out);
    const end = all.indexOf('\r\n\r\n');
    const head = all.subarray(0, end).toString().split('\r\n');
    const status = Number(/^Status: (\d+)/u.exec(head.find((line) => line.startsWith('Status:')) ?? '')?.[1] ?? 200);
    const headers = Object.fromEntries(head.filter((line) => !line.startsWith('Status:')).map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon), line.slice(colon + 1).trim()];
    }));
    response.writeHead(status, headers).end(all.subarray(end + 4));
  });
}

/** Every file under `dir` that holds any of `secrets`. */
async function filesHolding(dir: string, secrets: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const text = await readFile(path, 'latin1');
    if (secrets.some((secret) => text.includes(secret))) found.push(path);
  }
  return found;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}
