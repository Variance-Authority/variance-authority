#!/usr/bin/env node
// compass: variance-authority.review
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cloudflare } from './cloudflare.js';
import { registerApp } from './github-app.js';
import { provision, type Command, type ProvisionRequest, type RunOptions } from './provision.js';

/**
 * `variance-authority-tribunal-provision` — a Cloudflare tribunal's account and
 * repository setup, in one command an agent can run.
 *
 *     npx -p @variance-authority/tribunal variance-authority-tribunal-provision --config deploy/wrangler.jsonc
 *
 * `--repository owner/name` names the repository whose writers review and whose CI pushes builds; the
 * one `gh` sees in the working directory when absent. `--mount /api` is where the
 * deployment serves the API, when not at the root. `--skip-deploy` leaves
 * publishing to a deployment with its own build. `--rotate` replaces the session
 * key, and the ingest token where `token` is declared.
 */

const USAGE = 'usage: variance-authority-tribunal-provision [--config wrangler.jsonc] [--repository owner/name] [--mount /api] [--skip-deploy] [--rotate]';

export async function readRequest(argv: readonly string[], run = runCommand): Promise<ProvisionRequest | 'help'> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      config: { type: 'string', default: 'wrangler.jsonc' },
      repository: { type: 'string' },
      rotate: { type: 'boolean', default: false },
      mount: { type: 'string' },
      'skip-deploy': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return 'help';
  let repository = values.repository;
  if (repository === undefined) {
    const viewed = await run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    repository = viewed.stdout.trim();
    if (viewed.code !== 0 || repository === '') {
      throw new Error(`no --repository, and gh sees no repository here\n${USAGE}`);
    }
  }
  return {
    config: values.config,
    repository,
    rotate: values.rotate,
    ...(values.mount === undefined ? {} : { mount: values.mount }),
    ...(values['skip-deploy'] ? { skipDeploy: true } : {}),
  };
}

export function runCommand(program: string, args: readonly string[], options: RunOptions = {}): Promise<Command> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      env: { ...process.env, ...options.env },
      stdio: options.interactive === true ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin?.end(options.input ?? '');
  });
}

const OPENER: Readonly<Record<string, string>> = { darwin: 'open', win32: 'explorer' };

/** A placeholder answers 200 in text, and a Worker that cannot start answers 500 in JSON. */
export async function serving(url: string, send: typeof fetch = fetch): Promise<boolean> {
  const response = await send(url).catch(() => null);
  return response?.ok === true && response.headers.get('content-type')?.includes('json') === true;
}

async function main(): Promise<void> {
  const request = await readRequest(process.argv.slice(2));
  if (request === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const say = (line: string): void => void process.stdout.write(`${line}\n`);
  process.exitCode = await provision(
    {
      run: runCommand,
      read: (path) => readFile(path, 'utf8'),
      write: async (path, text) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, text);
      },
      exists: (path) => access(path).then(() => true, () => false),
      say,
      mint: () => randomBytes(24).toString('hex'),
      cloudflare: (token, account) => cloudflare(token, account, fetch),
      installed: fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, ''),
      register: (app, created) =>
        registerApp(app, {
          say,
          created,
          // The address is also said, so a run with no browser to open still works.
          open: async (url) => void (await runCommand(OPENER[process.platform] ?? 'xdg-open', [url])),
        }),
      serving: (url) => serving(url),
    },
    request,
  );
}

const invoked = process.argv[1];
if (invoked !== undefined && (await realpath(invoked)) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
