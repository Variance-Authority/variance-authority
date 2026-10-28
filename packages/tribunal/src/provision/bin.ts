#!/usr/bin/env node
// compass: variance-authority.review
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cloudflare } from './cloudflare.js';
import { provision, type Command, type ProvisionRequest, type RunOptions } from './provision.js';

/**
 * `variance-authority-tribunal-provision` — a Cloudflare tribunal's account and
 * repository setup, in one command an agent can run.
 *
 *     npx -p @variance-authority/tribunal variance-authority-tribunal-provision --config deploy/wrangler.jsonc
 *
 * `--repository owner/name` names the repository whose CI pushes builds; the
 * one `gh` sees in the working directory when absent. `--reviewer <email>` is
 * who may sign in to review; the Cloudflare login's email when absent.
 * `--mount /api` is where the deployment serves the API, when not at the root.
 * `--rotate` replaces both tokens.
 */

const USAGE = 'usage: variance-authority-tribunal-provision [--config wrangler.jsonc] [--repository owner/name] [--reviewer email] [--mount /api] [--rotate]';

export async function readRequest(argv: readonly string[], run = runCommand): Promise<ProvisionRequest | 'help'> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      config: { type: 'string', default: 'wrangler.jsonc' },
      repository: { type: 'string' },
      reviewer: { type: 'string' },
      rotate: { type: 'boolean', default: false },
      mount: { type: 'string' },
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
    ...(values.reviewer === undefined ? {} : { reviewer: values.reviewer }),
    ...(values.mount === undefined ? {} : { mount: values.mount }),
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

async function main(): Promise<void> {
  const request = await readRequest(process.argv.slice(2));
  if (request === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  process.exitCode = await provision(
    {
      run: runCommand,
      read: (path) => readFile(path, 'utf8'),
      write: (path, text) => writeFile(path, text),
      say: (line) => void process.stdout.write(`${line}\n`),
      mint: () => randomBytes(24).toString('hex'),
      terminal: process.stdout.isTTY === true,
      cloudflare: (token, account) => cloudflare(token, account, fetch),
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
