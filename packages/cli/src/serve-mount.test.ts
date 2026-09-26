import { execFile, spawn } from 'node:child_process';
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
  });

  it('answers a source question from the checkout it was started in', async () => {
    const result = await ask<{ readonly content: readonly { readonly text: string }[] }>('tools/call', {
      name: 'docs_packages',
    });
    expect(result.content[0]!.text).toContain('mounted');
  });
});

describe('`variance serve` in a checkout with no report', () => {
  it('answers from the mainline record the share holds, and every answer names the commit it read', async () => {
    const checkout = await mkdtemp(join(tmpdir(), 'variance-serve-share-'));
    try {
      const git = async (...args: string[]): Promise<string> => (await promisify(execFile)('git', args, { cwd: checkout })).stdout.trim();
      await git('init', '--quiet', '-b', 'main');
      await git('-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '--quiet', '--allow-empty', '-m', 'one');
      const commit = await git('rev-parse', 'HEAD');
      const share = { kind: 'directory', root: join(checkout, 'share'), mainlines: ['main'] } as const;
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
      // CI's run, written somewhere this checkout's configured report is not.
      const ci = join(checkout, 'ci', 'run.json');
      await writeRunReport(ci, { ...REPORT, run: { id: 'ci', commit }, composition: { subjects: ['page/home'], components: [] } } as unknown as RunReport);
      const config = { project: 'mounted', report: join(checkout, 'report.json'), share, reportCarry: 'share' } as Config;
      const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };
      expect(await publishRun(config, ci, { env, cwd: checkout })).toMatchObject({ published: { written: ['suite-index-v1', 'report-v1'] } });

      const result = await ask<{ readonly content: readonly { readonly text: string }[] }>(
        'tools/call',
        { name: 'variance_summary' },
        checkout,
      );
      expect(result.content[0]!.text).toMatch(new RegExp(`^report: read from mainline main, evaluated at ${commit}, .*; kept at .+run\\.json\\.\n\n`));
    } finally {
      await rm(checkout, { recursive: true, force: true });
    }
  });
});

async function ask<Result>(method: string, params?: Record<string, unknown>, cwd = workspace): Promise<Result> {
  // Nothing from the host's CI: which line a reader reads is decided by the
  // checkout here, not by the pull request this suite happens to run for.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GITHUB_')));
  const child = spawn(process.execPath, [BIN, 'serve'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...env, NO_COLOR: '1', XDG_CACHE_HOME: join(cwd, 'cache') },
  });
  try {
    const answer = new Promise<Result>((resolve, reject) => {
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
          const response = JSON.parse(line) as {
            readonly id?: number;
            readonly result?: Result;
            readonly error?: { readonly message: string };
          };
          if (response.id !== 1) continue;
          if (response.error !== undefined) reject(new Error(response.error.message));
          else resolve(response.result!);
          return;
        }
      });
      child.on('error', reject);
      child.on('exit', (code) => reject(new Error(`the server exited with ${String(code)} before answering: ${said}`)));
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })}\n`);
    return await answer;
  } finally {
    child.kill();
  }
}
