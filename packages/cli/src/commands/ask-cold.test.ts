import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sourceIndexPath } from '@variance-authority/sense';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/**
 * Every source question asked of a checkout nothing has indexed yet, through
 * the command a person types. Each one answers or refuses with a code; none
 * reaches the "does not have a code for" arm, which is a defect in the tool.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-ask-cold-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
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
  it('search reads the checkout when nothing is published, and does not call that reading uncompared', async () => {
    cold();
    const answered = await run(['ask', 'search', '--query', 'shim']);
    expect(answered.err).toBe('');
    expect(answered.code).toBe(EXIT_CLEAN);
    expect(answered.out).toContain('shim');
    expect(answered.out).toContain('\nSnapshot ');
    expect(answered.out).not.toContain('not compared with the checkout');
  });

  it('search says which published search did not open, and that it read the checkout instead', async () => {
    const root = cold();
    const at = `${sourceIndexPath(root)}.help-search.bin`;
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, 'not a search');
    const answered = await run(['ask', 'search', '--query', 'shim']);
    expect(answered.code).toBe(EXIT_CLEAN);
    expect(answered.out).toContain(`The published search at ${at} did not open (`);
    expect(answered.out).toContain('the checkout was read instead.');

    writeFileSync(at, 'not a search');
    const json = JSON.parse((await run(['ask', 'search', '--query', 'shim', '--format', 'json'])).out) as { unopened?: readonly { at: string }[] };
    expect(json.unopened?.map((one) => one.at)).toEqual([at]);
  });

  it('search --format json from a read of the checkout carries its generation without `compared: false`', async () => {
    cold();
    const answered = await run(['ask', 'search', '--query', 'shim', '--format', 'json']);
    expect(answered.code).toBe(EXIT_CLEAN);
    const data = JSON.parse(answered.out) as { generatedAt?: string; compared?: boolean };
    expect(data.generatedAt).toBeDefined();
    expect(data.compared).toBeUndefined();
  });

  it('search --just-answer refuses with a code, names the flag it was given and `variance index` as the remedy', async () => {
    cold();
    const answered = await run(['ask', 'search', '--query', 'shim', '--just-answer']);
    answeredOrRefused(answered);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('Run `variance index`');
    expect(answered.err).toContain('asked with `--just-answer`');
  });

  it('search answers once `variance index` has published the generation, and says it opened it uncompared', async () => {
    cold();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const answered = await run(['ask', 'search', '--query', 'shim']);
    expect(answered.err).toBe('');
    expect(answered.code).toBe(EXIT_CLEAN);
    expect(answered.out).toContain('shim');
    expect(answered.out).toContain('not compared with the checkout');
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

  it('symbol --just-answer refuses with a code and names `variance index` as the remedy', async () => {
    cold();
    const answered = await run(['ask', 'symbol', '--name', 'shim', '--just-answer']);
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
