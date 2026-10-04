import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  encodeExecutionIndex,
  testCoverageFile,
  withCaseSections,
  writeTestCoverage,
} from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

const cwd = process.cwd();
const made: string[] = [];

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-distill-scope-cache-'));
  made.push(process.env['VARIANCE_AUTHORITY_CACHE']);
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

const UNIT = ['app/test/cart.test.ts', 'lib/test/price.test.ts'];
const E2E = ['e2e/checkout.test.ts'];

// Every test file imports the cart; the cart imports a chart no case draws.
const SOURCES: Readonly<Record<string, string>> = {
  ...Object.fromEntries([...UNIT, ...E2E].map((file) => [file, "import { Cart } from '../../src/cart';\n".replace('../../', file.startsWith('e2e/') ? '../' : '../../')])),
  'src/cart.ts': "import { Chart } from './chart';\nexport const Cart = [Chart];\n",
  'src/chart.ts': 'export const Chart = 1;\n',
};

/** A record holding `files`, each with one finished case that entered the cart and not the chart. */
async function recorded(at: string, files: readonly string[]): Promise<void> {
  const row = (file: string, endLine: number) => ({
    file, sourceDigest: file, instrumented: true, blocks: [
      { ordinal: 0, kind: 'module' as const, digest: `${file}#0`, name: '', path: '', source: true, testFiles: files, loadedBy: files, startLine: 1, endLine },
      { ordinal: 1, kind: 'function' as const, owner: 0, digest: `${file}#1`, name: 'main', path: 'main', source: true, testFiles: files, startLine: 2, endLine: 2 },
    ],
  });
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [row('src/cart.ts', 5), row('src/chart.ts', 30)],
  });
  const block = { kind: 'function', name: 'main', path: 'main', startLine: 2, endLine: 2, source: true };
  writeFileSync(at, withCaseSections(readFileSync(at), {
    index: encodeExecutionIndex({
      tests: files.map((file) => ({ id: `${file} > one`, file, name: 'one', stopped: false })),
      modules: [
        { file: 'src/cart.ts', blocks: [{ ...block, crossings: files.map((_, test) => ({ test, distance: 0 })) }] },
        { file: 'src/chart.ts', blocks: [{ ...block, crossings: [] }] },
      ],
    }),
  }));
}

/** A checkout declaring a `unit` and an `e2e` suite, each recorded, with its sources indexed; or, declaring none, one record. */
async function checkout(suites: { readonly unit?: boolean; readonly e2e: boolean } | 'undeclared' = { e2e: true }): Promise<string> {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-distill-scope-')));
  made.push(root);
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
  if (suites !== 'undeclared') writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' }, e2e: { kind: 'e2e' } } }));
  for (const [file, text] of Object.entries(SOURCES)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  execFileSync('git', ['add', '.'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'source'], { cwd: root, stdio: 'pipe' });
  if (suites === 'undeclared') await recorded(testCoverageFile(root), [...UNIT, ...E2E]);
  else {
    if (suites.unit !== false) await recorded(testCoverageFile(root, { suite: 'unit' }), UNIT);
    if (suites.e2e) await recorded(testCoverageFile(root, { suite: 'e2e' }), E2E);
  }
  // Published as a pipeline publishes it: under CI a reader refuses to build the index itself.
  expect((await run(['index'])).code).toBe(EXIT_CLEAN);
  return root;
}

describe('distill over a scope of test files', () => {
  it('reads every declared suite when no scope is named', async () => {
    await checkout();

    const answer = await run(['distill']);

    expect(answer.err).toBe('');
    expect(answer.code).toBe(EXIT_CLEAN);
    expect(answer.out).toContain('every test file in suites e2e, unit: 3 test file(s), each read.');
    expect(answer.out).toContain('  src/cart.ts imports src/chart.ts: 1 module(s) in 3 test file(s), 90 line(s)');
  });

  it('reads one suite when `--suite` names it', async () => {
    await checkout();

    const json = JSON.parse((await run(['distill', '--suite', 'unit', '--format', 'json'])).out);

    expect(json.suites).toEqual(['unit']);
    expect(json.spills).toEqual([{
      cause: { kind: 'import', importer: 'src/cart.ts', imported: 'src/chart.ts' },
      modules: ['src/chart.ts'],
      files: UNIT,
      lines: 60,
    }]);
  });

  it('reads the test files under the directory `--from` names, in every suite', async () => {
    await checkout();

    const answer = await run(['distill', '--from', 'app/']);

    expect(answer.code).toBe(EXIT_CLEAN);
    expect(answer.out).toContain('app in suite unit: 1 test file(s), each read.');
    expect(answer.out).toContain('  src/cart.ts imports src/chart.ts: 1 module(s) in 1 test file(s), 30 line(s)');
  });

  it('names a declared suite that has not recorded, and reads the rest', async () => {
    await checkout({ e2e: false });

    const answer = await run(['distill']);

    expect(answer.code).toBe(EXIT_CLEAN);
    expect(answer.out).toContain('every test file in suite unit: 2 test file(s), each read.');
    expect(answer.out).toContain('Not recorded: suite e2e.');
  });

  it('reads the one record of a repository that declares no suites', async () => {
    await checkout('undeclared');

    const answer = await run(['distill']);

    expect(answer.code).toBe(EXIT_CLEAN);
    expect(answer.out).toContain('every test file: 3 test file(s), each read.');
  });

  it('refuses, naming every declared suite, when none has recorded', async () => {
    await checkout({ unit: false, e2e: false });

    const answer = await run(['distill']);

    expect(answer.code).toBe(EXIT_OPERATOR);
    expect(answer.err).toContain('none of the suites it declares, "e2e", "unit", has a per-case index');
  });

  it('refuses `--from` beside `--test` or `--file`, which name one case or one file', async () => {
    await checkout();

    const answer = await run(['distill', '--from', 'app', '--file', 'cart.test']);

    expect(answer.code).toBe(EXIT_OPERATOR);
    expect(answer.err).toContain('--from');
  });
});
