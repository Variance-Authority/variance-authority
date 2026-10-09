import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunReport } from '@variance-authority/report';
import { writeRunReport } from '@variance-authority/report/file';
import type { Config } from './config.js';
import { publishRun } from './commands/share.js';

/**
 * One connection answers about the run and about the code.
 *
 * The two tool sets are mounted in `commands/serve.ts` over one composite
 * subject, and nothing else in the suite runs that file: the tools are tested
 * where they are written, and the wiring that puts both on one server is
 * exactly what a unit test of either half cannot see. An agent that asked
 * `docs_search` here and was told no such tool exists would have to be
 * configured with a second server, which is the arrangement this mount
 * removed — so the assertion is that both names come back from one
 * `tools/list`, and that a source question is actually answered over it.
 *
 * Spawned rather than called, because `serve` speaks on `process.stdin` and
 * `process.stdout` and the transport is half of what is being checked.
 */

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

const REPORT: RunReport = {
  runVersion: 1,
  at: '2026-08-01T10:00:00.000Z',
  identity: {
    renderer: 'playwright-chromium',
    engine: 'chromium@131.0.0',
    platform: 'darwin/arm64',
    deviceScaleFactor: 1,
    fonts: [],
  },
  retention: 'ephemeral',
  observations: [{ subject: 'page/home', verdict: 'unchanged' }],
  notObserved: [],
  findings: [],
};

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'variance-serve-mount-'));
  await mkdir(join(workspace, 'src'), { recursive: true });
  await writeFile(
    join(workspace, 'package.json'),
    JSON.stringify({ name: 'mounted', version: '0.0.0', type: 'module', exports: { '.': './src/index.ts' } }),
  );
  await writeFile(join(workspace, 'src/index.ts'), 'export const mounted = 1;\n');
  await writeRunReport(join(workspace, 'report.json'), REPORT);
  await writeFile(
    join(workspace, 'variance.config.json'),
    JSON.stringify({
      project: 'mounted',
      profile: 'chromium',
      viewport: { width: 256, height: 96, deviceScaleFactor: 1, colorScheme: 'light' },
      retention: 'ephemeral',
      subjects: { kind: 'collector', collector: 'collector/index.mjs' },
      fonts: ['Arial/600/normal/system'],
      report: 'report.json',
    }),
  );
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('the server `variance serve` starts', () => {
  it('lists the run tools and the source tools together', async () => {
    const names = await ask<{ readonly tools: readonly { readonly name: string }[] }>('tools/list').then(
      (result) => result.tools.map((tool) => tool.name),
    );
    expect(names).toContain('variance_summary');
    expect(names).toContain('docs_search');
    expect(names).toContain('docs_packages');
    expect(names).toContain('variance_costs');
    expect(names).toContain('variance_decisions');
  });

  it('answers a source question from the checkout it was started in', async () => {
    const result = await ask<Answer>('tools/call', { name: 'docs_packages' });
    expect(result.content[0]!.text).toContain('mounted');
  });
});

describe('`variance serve` in a checkout with no report', () => {
  it('answers from the mainline record the share holds, and every answer names the commit it read', async () => {
    const { checkout, commit } = await checkoutWithShare();
    try {
      const result = await ask<Answer>('tools/call', { name: 'variance_summary' }, checkout);
      expect(result.content[0]!.text).toMatch(new RegExp(`^report: read from mainline main, evaluated at ${commit}, .*; kept at .+report\\.json\\.\n\n`));
    } finally {
      await rm(checkout, { recursive: true, force: true });
    }
  });

  it('answers from this checkout\'s own run once it is written, and the comparison across the two says what it compared', async () => {
    const { checkout, commit } = await checkoutWithShare();
    const server = session(checkout);
    try {
      const first = await server.request<Answer>('tools/call', { name: 'variance_summary' });
      expect(first.content[0]!.text).toMatch(/^report: read from mainline main, /);

      await writeRunReport(join(checkout, 'report.json'), { ...REPORT, observations: [{ subject: 'page/home', verdict: 'changed' }] } as unknown as RunReport);
      const compared = await server.request<Answer>('tools/call', { name: 'variance_diff' });
      expect(compared.content[0]!.text).toMatch(new RegExp(
        `^report: this checkout's own run, compared with the report the previous answer read from mainline main at ${commit}\\.\n\nThe current state differs`,
      ));
      const own = await server.request<Answer>('tools/call', { name: 'variance_summary' });
      expect(own.content[0]!.text).not.toMatch(/^report: /);
      const again = await server.request<Answer>('tools/call', { name: 'variance_diff' });
      expect(again.content[0]!.text).toMatch(/^The current state matches the previous invocation\./);
    } finally {
      server.close();
      await rm(checkout, { recursive: true, force: true });
    }
  });

  it('answers where the time goes from the mainline, and a mainline with none is refused without closing the connection', async () => {
    const timed = await checkoutWithShare(true);
    const bare = await checkoutWithShare();
    const server = session(bare.checkout);
    try {
      const answer = await ask<Answer>('tools/call', { name: 'variance_costs' }, timed.checkout);
      expect(answer.content[0]!.text).toContain('1.2 s  src/home.stories.tsx  1 subject');

      const refused = await server.request<Answer & { readonly isError?: boolean }>('tools/call', { name: 'variance_costs' });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]!.text).toMatch(/no subject costs on the mainline/);
      const after = await server.request<Answer>('tools/call', { name: 'variance_summary' });
      expect(after.content[0]!.text).toMatch(/^report: read from mainline main, /);
    } finally {
      server.close();
      await rm(timed.checkout, { recursive: true, force: true });
      await rm(bare.checkout, { recursive: true, force: true });
    }
  });

  it('refuses to start when the share cannot be reached, and says which lines it asked and why', async () => {
    const checkout = await mkdtemp(join(tmpdir(), 'variance-serve-unreachable-'));
    const closed = createServer();
    await new Promise<void>((listening) => closed.listen(0, '127.0.0.1', listening));
    const endpoint = `http://127.0.0.1:${String((closed.address() as AddressInfo).port)}`;
    await new Promise((done) => closed.close(done));
    try {
      await git(checkout, 'init', '--quiet', '-b', 'main');
      await writeConfig(checkout, { kind: 'http', endpoint, mainlines: ['main'] });
      await expect(ask('tools/list', undefined, checkout)).rejects.toThrow(
        new RegExp(`mainline main: ${endpoint}/mainline/main/manifest\\.json: fetch failed: .*ECONNREFUSED`),
      );
    } finally {
      await rm(checkout, { recursive: true, force: true });
    }
  });
});

describe('what reviewers decided, over `variance serve`', () => {
  it('is read from the review deployment with the share token, and a refusal does not close the connection', async () => {
    const asked: { method: string; url: string; authorization: string | undefined }[] = [];
    let refuse = false;
    const deployment = createServer((request, response) => {
      asked.push({ method: request.method ?? '', url: request.url ?? '', authorization: request.headers.authorization });
      response.setHeader('content-type', 'application/json');
      if (refuse) {
        response.statusCode = 403;
        response.end(JSON.stringify({ error: 'that token does not read here' }));
        return;
      }
      response.end(JSON.stringify({
        decisions: [{ build: 'ci-1', subject: 'story:a', decision: 'approved', by: 'marina', at: '2026-06-02T10:00:00.000Z' }],
      }));
    });
    await new Promise<void>((listening) => deployment.listen(0, '127.0.0.1', listening));
    const endpoint = `http://127.0.0.1:${String((deployment.address() as AddressInfo).port)}`;
    const checkout = await mkdtemp(join(tmpdir(), 'variance-serve-decisions-'));
    await writeRunReport(join(checkout, 'report.json'), REPORT);
    await writeFile(
      join(checkout, 'variance.config.json'),
      JSON.stringify({
        project: 'mounted',
        profile: 'chromium',
        viewport: { width: 256, height: 96, deviceScaleFactor: 1, colorScheme: 'light' },
        retention: 'ephemeral',
        subjects: { kind: 'collector', collector: 'collector/index.mjs' },
        fonts: ['Arial/600/normal/system'],
        report: 'report.json',
        review: { endpoint, token: { env: 'VARIANCE_REVIEW_INGEST_TOKEN' } },
        share: { kind: 'http', endpoint: `${endpoint}/share`, token: { env: 'VARIANCE_SHARE_TOKEN' } },
      }),
    );
    const server = session(checkout, { VARIANCE_SHARE_TOKEN: 'share-secret', VARIANCE_REVIEW_INGEST_TOKEN: 'ingest-secret' });
    try {
      const answer = await server.request<Answer>('tools/call', { name: 'variance_decisions', arguments: { subject: 'story:a' } });
      expect(answer.content[0]!.text).toContain('2026-06-02T10:00:00.000Z  approved  story:a  ci-1  marina');
      expect(asked).toEqual([
        { method: 'GET', url: '/review/decisions?subject=story%3Aa&limit=20', authorization: 'Bearer share-secret' },
      ]);

      refuse = true;
      const refused = await server.request<Answer & { readonly isError?: boolean }>('tools/call', { name: 'variance_decisions' });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]!.text).toMatch(/answered 403: that token does not read here/);
      const after = await server.request<Answer>('tools/call', { name: 'variance_summary' });
      expect(after.content[0]!.text).not.toBe('');
    } finally {
      server.close();
      await new Promise((done) => deployment.close(done));
      await rm(checkout, { recursive: true, force: true });
    }
  });
});

interface Answer {
  readonly content: readonly { readonly text: string }[];
}

/** A repository on `main` with one commit, and CI's run for it published to a directory share its config names. */
async function checkoutWithShare(timed = false): Promise<{ readonly checkout: string; readonly commit: string }> {
  const checkout = await mkdtemp(join(tmpdir(), 'variance-serve-share-'));
  await git(checkout, 'init', '--quiet', '-b', 'main');
  await git(checkout, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '--quiet', '--allow-empty', '-m', 'one');
  const commit = await git(checkout, 'rev-parse', 'HEAD');
  const share = { kind: 'directory', root: join(checkout, 'share'), mainlines: ['main'] } as const;
  await writeConfig(checkout, share);
  // CI's run, written somewhere this checkout's configured report is not.
  const ci = join(checkout, 'ci', 'run.json');
  const observations = timed ? [{ subject: 'page/home', verdict: 'unchanged', costMs: 1234, declaredIn: 'src/home.stories.tsx' }] : REPORT.observations;
  await writeRunReport(ci, { ...REPORT, observations, run: { id: 'ci', commit }, composition: { subjects: ['page/home'], components: [] } } as unknown as RunReport);
  const config = { project: 'mounted', report: join(checkout, 'report.json'), share, reportCarry: 'share' } as unknown as Config;
  const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };
  const written = ['suite-index-v2', 'report-v1', ...(timed ? ['subject-costs-v1'] : [])];
  expect(await publishRun(config, ci, { env, cwd: checkout })).toMatchObject({ published: { written } });
  return { checkout, commit };
}

async function writeConfig(checkout: string, share: Readonly<Record<string, unknown>>): Promise<void> {
  await writeFile(
    join(checkout, 'variance.config.json'),
    JSON.stringify({
      project: 'mounted',
      profile: 'chromium',
      viewport: { width: 256, height: 96, deviceScaleFactor: 1, colorScheme: 'light' },
      retention: 'ephemeral',
      subjects: { kind: 'collector', collector: 'collector/index.mjs' },
      fonts: ['Arial/600/normal/system'],
      report: { path: 'report.json', carry: 'share' },
      share,
    }),
  );
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await promisify(execFile)('git', args, { cwd })).stdout.trim();
}

async function ask<Result>(method: string, params?: Record<string, unknown>, cwd = workspace): Promise<Result> {
  const server = session(cwd);
  try {
    return await server.request<Result>(method, params);
  } finally {
    server.close();
  }
}

/**
 * One `variance serve` process, asked one request at a time over the life of
 * the connection, as an agent asks it.
 */
function session(cwd = workspace, variables: Readonly<Record<string, string>> = {}): {
  request<Result>(method: string, params?: Record<string, unknown>): Promise<Result>;
  close(): void;
} {
  // Nothing from the host's CI: which line a reader reads is decided by the
  // checkout here, not by the pull request this suite happens to run for.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GITHUB_')));
  const child = spawn(process.execPath, [BIN, 'serve'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...env, ...variables, NO_COLOR: '1', VARIANCE_AUTHORITY_CACHE: join(cwd, 'cache') },
  });
  const waiting = new Map<number, { resolve(result: unknown): void; reject(error: Error): void }>();
  let ended: Error | undefined;
  let next = 0;
  let buffer = '';
  let said = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    said += chunk;
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim() === '') continue;
      const response = JSON.parse(line) as { readonly id?: number; readonly result?: unknown; readonly error?: { readonly message: string } };
      const pending = response.id === undefined ? undefined : waiting.get(response.id);
      if (pending === undefined) continue;
      waiting.delete(response.id!);
      if (response.error !== undefined) pending.reject(new Error(response.error.message));
      else pending.resolve(response.result);
    }
  });
  const end = (error: Error): void => {
    ended = error;
    for (const pending of waiting.values()) pending.reject(error);
    waiting.clear();
  };
  child.on('error', end);
  // `close` rather than `exit`, so everything the server wrote to stderr has been read.
  child.on('close', (code) => end(new Error(`the server exited with ${String(code)} before answering: ${said}`)));

  return {
    request<Result>(method: string, params?: Record<string, unknown>): Promise<Result> {
      if (ended !== undefined) return Promise.reject(ended);
      next += 1;
      const id = next;
      const answer = new Promise<Result>((resolve, reject) => {
        waiting.set(id, { resolve: resolve as (result: unknown) => void, reject });
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return answer;
    },
    close(): void {
      child.kill();
    },
  };
}
