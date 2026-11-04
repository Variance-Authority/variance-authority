import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexTurnPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/**
 * `variance index` where its turn, or the addon that takes it, is not to be had,
 * through the binary: what is under test is the line a person reads and the exit
 * code, and a thrown error reaches both only past `bin.ts`.
 */

const BIN = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-turn-cache-')));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function checkout(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-turn-')));
  writeFileSync(join(root, 'unit.ts'), 'export const unit = 1;\n');
  const git = (...args: readonly string[]): void => { execFileSync('git', args, { cwd: root, stdio: 'pipe' }); };
  git('init', '--quiet', '--initial-branch', 'main');
  git('add', '-A');
  git('-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', 'commit', '--quiet', '-m', 'the checkout');
  return root;
}

/** `variance index` in `root`, its follow-ups in this process. */
function indexed(root: string, env: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [BIN, 'index'], { cwd: root, env: { ...process.env, CI: 'true', ...env }, encoding: 'utf8' });
}

function expectIndexedAlone(run: SpawnSyncReturns<string>, path: string, reason: string): void {
  expect(run.stderr).not.toContain('defect in the tool');
  expect(run.status).toBe(EXIT_CLEAN);
  expect(run.stdout).toContain('source index built: 1 file');
  expect(run.stderr).toContain(`no index turn at ${path}: ${reason}, so this index may run beside another of this repository\n`);
}

describe('variance index, when the turn is refused', () => {
  // A mode is no refusal to root, and Windows has no owner, group and other bits.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('indexes alone when the lock opens and nothing can be written beside it', () => {
    const root = checkout();
    const path = indexTurnPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
    chmodSync(dirname(path), 0o555);
    onTestFinished(() => { chmodSync(dirname(path), 0o755); });

    expectIndexedAlone(indexed(root), path, `${path}.holder: Permission denied (os error 13)`);
  });

  it('indexes alone when a directory stands where the holder is named', () => {
    const root = checkout();
    const path = indexTurnPath(root);
    mkdirSync(`${path}.holder`, { recursive: true });

    expectIndexedAlone(indexed(root), path, `${path}.holder: Is a directory (os error 21)`);
  });
});

describe('variance index, when the addon did not load', () => {
  it('says what is wrong and what to do, as the operator\'s to fix', () => {
    const root = checkout();
    // No `.node` loads in this process, as on a machine no binary reached.
    const preload = join(mkdtempSync(join(tmpdir(), 'va-turn-preload-')), 'no-addon.cjs');
    writeFileSync(preload, [
      "const Module = require('node:module');",
      'const load = Module._load;',
      'Module._load = function (request, ...rest) {',
      "  if (/sense-[a-z0-9-]+$|\\.node$/u.test(request)) throw Object.assign(new Error(`Cannot find module '${request}'`), { code: 'MODULE_NOT_FOUND' });",
      '  return load.call(this, request, ...rest);',
      '};',
    ].join('\n'));

    const run = indexed(root, { NODE_OPTIONS: `--require ${preload}` });

    expect(run.status).toBe(EXIT_OPERATOR);
    expect(run.stderr).not.toContain('defect in the tool');
    expect(run.stderr).not.toMatch(/^\s+at /mu);
    expect(run.stderr).toMatch(/^the index turn is taken by the native addon, which did not load: \S+ is not installed\. Install again without `--omit=optional`, or, on a platform no package is published for, build the addon from the checkout with `cargo`\.$/mu);
  });
});
