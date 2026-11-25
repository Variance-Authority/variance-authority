import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sourceIndexPath } from '@variance-authority/sense';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/**
 * Every source question asked of a checkout nothing has indexed yet, through
 * the command a person types. A question reads only what `variance index`
 * published, so each one answers or refuses with a code; none
 * reaches the "does not have a code for" arm, which is a defect in the tool.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-ask-cold-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

/** A committed one-package workspace with an empty cache: no scan index, no workspace value, no recording. */
function cold(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-ask-cold-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '--quiet', '--initial-branch', 'main');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cold', private: true, workspaces: ['packages/*'] }));
  mkdirSync(join(root, 'packages/shim/src'), { recursive: true });
  writeFileSync(
    join(root, 'packages/shim/package.json'),
    JSON.stringify({ name: '@cold/shim', version: '1.0.0', type: 'module', exports: { '.': './src/index.js' } }),
  );
  writeFileSync(
    join(root, 'packages/shim/src/index.js'),
    '/** Stands in for the platform call a test cannot make. */\nexport function shim() {\n  return 1;\n}\n',
  );
  git('add', '-A');
  git('-c', 'user.email=cold@example.test', '-c', 'user.name=cold', 'commit', '--quiet', '-m', 'init');
  process.chdir(root);
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

function answeredOrRefused(answered: { code: number; err: string }): void {
  expect(answered.err).not.toContain('does not have a code for');
  expect([EXIT_CLEAN, EXIT_OPERATOR]).toContain(answered.code);
}

describe('variance ask on a checkout with no index', () => {
  it('search refuses with a code and names `variance index` when nothing is published, and reads no checkout', async () => {
    const root = cold();
    const answered = await run(['ask', 'search', '--query', 'shim']);
    answeredOrRefused(answered);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.out).toBe('');
    expect(answered.err).toContain('Run `variance index`');
    expect(existsSync(`${sourceIndexPath(root)}.help.bin`)).toBe(false);
  });

  it('search says which published value did not open, and names `variance index`', async () => {
    const root = cold();
    const at = `${sourceIndexPath(root)}.help.bin`;
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, 'not a store');
    const answered = await run(['ask', 'search', '--query', 'shim']);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain(`the published value at ${at} did not open (`);
    expect(answered.err).toContain('Run `variance index`');
  });

  it('search answers once `variance index` has published the generation, and says it opened it uncompared', async () => {
    cold();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const answered = await run(['ask', 'search', '--query', 'shim']);
    expect(answered.err).toBe('');
    expect(answered.code).toBe(EXIT_CLEAN);
    expect(answered.out).toContain('shim');
    expect(answered.out).toContain('may miss later changes');
  });

  it('packages answers or refuses with a code', async () => {
    cold();
    answeredOrRefused(await run(['ask', 'packages']));
  });

  it('uses answers or refuses with a code', async () => {
    cold();
    answeredOrRefused(await run(['ask', 'uses', '--name', 'shim']));
  });

  it('symbol answers or refuses with a code', async () => {
    cold();
    answeredOrRefused(await run(['ask', 'symbol', '--name', 'shim']));
  });

  it('symbol refuses with a code and names `variance index` as the remedy', async () => {
    cold();
    const answered = await run(['ask', 'symbol', '--name', 'shim']);
    answeredOrRefused(answered);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('Run `variance index`');
  });

  it('entrypoint answers or refuses with a code', async () => {
    cold();
    answeredOrRefused(await run(['ask', 'entrypoint', '--package', '@cold/shim']));
  });

  it('journey-map answers or refuses with a code', async () => {
    cold();
    answeredOrRefused(await run(['ask', 'journey-map', '--file', 'packages/shim/src/index.js']));
  });
});
