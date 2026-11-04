import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexTurnPath, sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { indexOutput } from './index-command.js';

/**
 * `variance index` where its turn, or the addon that takes it, is not to be had.
 * Through the binary for the line a person reads and the exit code, since a
 * thrown error reaches both only past `bin.ts`; through `indexOutput` for what a
 * caller that is no process hears.
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

/** The lines of `output` saying the file system refused the turn at `path`. What it said after `said` is the platform's to spell, and it said something. */
function refusals(output: string, path: string, said = ''): readonly string[] {
  const opening = `no index turn at ${path}: ${said}`;
  const closing = ', so this index may run beside another of this repository';
  return output.split('\n').filter((line) => line.startsWith(opening) && line.endsWith(closing) && line.length > opening.length + closing.length);
}

/** The run went on and said why once, in its report. */
function expectIndexedAlone(run: SpawnSyncReturns<string>, path: string, said: string): void {
  expect(run.stderr).not.toContain('defect in the tool');
  expect(run.status).toBe(EXIT_CLEAN);
  expect(run.stdout).toContain('source index built: 1 file');
  expect(refusals(run.stdout, path, said)).toHaveLength(1);
  expect(run.stderr).not.toContain('no index turn');
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

    expectIndexedAlone(indexed(root), path, 'writing its .holder: ');
  });

  it('indexes alone when a directory stands where the holder is named', () => {
    const root = checkout();
    const path = indexTurnPath(root);
    mkdirSync(`${path}.holder`, { recursive: true });

    expectIndexedAlone(indexed(root), path, 'writing its .holder: ');
  });

  it('says so in its report to a caller that listens to nothing', async () => {
    const root = checkout();
    const path = indexTurnPath(root);
    mkdirSync(path, { recursive: true });

    const lines = (await indexOutput({ cwd: root })).split('\n');

    // The update and the follow-ups each ask for the turn, and the report says it once.
    expect(refusals(lines.join('\n'), path)).toEqual([lines[1]]);
    expect(lines[1]!.split(path)).toHaveLength(2);
    expect(lines[0]).toBe(`source index built: 1 file, at ${sourceIndexPath(root)}`);
    expect(lines[2]).toMatch(/^code map: /u);
  });

  it('tells nobody who waits: nothing is waited for', async () => {
    const root = checkout();
    mkdirSync(indexTurnPath(root), { recursive: true });
    const told: string[] = [];

    await indexOutput({ cwd: root, waiting: (text) => told.push(text) });
    expect(told).toEqual([]);
  });

  it.each([
    ['a process took the follow-ups', process.pid, 'follow-ups: '],
    ['no process could be started for them', undefined, 'code map: '],
  ])('says so in the report of a detached run when %s', async (_, pid, next) => {
    const root = checkout();
    const path = indexTurnPath(root);
    mkdirSync(path, { recursive: true });

    const lines = (await indexOutput({ cwd: root, detach: () => pid })).split('\n');

    expect(refusals(lines.join('\n'), path)).toEqual([lines[1]]);
    expect(lines[2]).toMatch(new RegExp(`^${next}`, 'u'));
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
