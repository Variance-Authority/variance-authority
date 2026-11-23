import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { encodeAsSetExecutionIndex, landCases, testCoverageFile, withCaseSections, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/** `variance proves`, through the command a person types, over a recorded test and a command that runs it. */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-proves-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

const SOURCES: Record<string, string> = {
  'src/total.mjs': 'export function total(a, b) {\n  return a + b;\n}\n',
  'src/log.mjs': 'export function log(line) {\n  globalThis.lines = [...(globalThis.lines ?? []), line];\n}\n',
  // The test: it logs, and asserts only the total.
  'test/total.check.mjs':
    "import { log } from '../src/log.mjs';\nimport { total } from '../src/total.mjs';\nlog('adding');\nif (total(2, 3) !== 5) process.exit(1);\n",
  'test/broken.check.mjs': 'process.exit(1);\n',
};

describe('variance proves', () => {
  it('names the regions the test survived broken, and the ones it noticed, leaving the checkout and the record as they were', async () => {
    const root = await recorded();
    const before = snapshot(root);

    const answered = await run(['proves', '--file', 'test/total.check.mjs', '--name', 'adds', '--', process.execPath, 'test/total.check.mjs']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')).toEqual([
      'test/total.check.mjs  adds',
      '',
      'Survived, the test passed with the region broken:',
      '  src/log.mjs:1-3  function log  returns nothing',
      '',
      'Noticed, the test failed with the region broken:',
      '  src/total.mjs:1-3  function total  returns nothing',
      '',
      'A survivor is an assertion that does not read the region, or a break that changes nothing the test can observe: this run cannot tell which.',
      '',
    ]);
    expect(snapshot(root)).toEqual(before);
  });

  it('refuses a command that fails with nothing broken', async () => {
    await recorded();

    const answered = await run(['proves', '--file', 'test/total.check.mjs', '--name', 'adds', '--', process.execPath, 'test/broken.check.mjs']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('fails with nothing broken');
  });
});

/** Every file under `root` with its text, the record among them. */
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[path] = readFileSync(path, 'latin1');
    }
  };
  walk(root);
  walk(process.env['VARIANCE_AUTHORITY_CACHE'] ?? '');
  return files;
}

/**
 * A checkout holding two functions and a test that enters both, recorded as
 * one test, `adds`, that entered `total` and `log`, with one other test that
 * entered `total` too.
 */
async function recorded(): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-proves-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  for (const [file, text] of Object.entries(SOURCES)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  process.chdir(root);
  const at = testCoverageFile(root);
  const files = ['test/total.check.mjs', 'test/other.check.mjs'];
  const tests = [
    { id: 'a', file: files[0] ?? '', name: 'adds' },
    { id: 'o', file: files[1] ?? '', name: 'adds again' },
  ];
  const fileOf = (test: number) => tests[test]?.file ?? '';
  const region = (kind: string, name: string, startLine: number, endLine: number, entered: readonly number[]) => ({ kind, name, path: 'entry', startLine, endLine, source: true, entered });
  const modules = [
    { file: 'src/log.mjs', regions: [region('function', 'log', 1, 3, [0])] },
    { file: 'src/total.mjs', regions: [region('function', 'total', 1, 3, [0, 1])] },
  ];
  const none = 0xffffffff;
  const owners = modules.map(() => Uint32Array.from([none]));
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: modules.map(({ file, regions }) => ({
      file,
      sourceDigest: `digest:${file}`,
      instrumented: true,
      blocks: regions.map(({ entered, ...block }, ordinal) => ({ ...block, ordinal, digest: `block:${file}:${ordinal}`, testFiles: [...new Set(entered.map(fileOf))] })),
    })),
  });
  const shard = join(mkdtempSync(join(tmpdir(), 'va-proves-shard-')), 'run.bin');
  writeFileSync(shard, withCaseSections(readFileSync(at), { index: encodeAsSetExecutionIndex({
    tests,
    modules: modules.map(({ file, regions }) => ({
      file,
      blocks: regions.map(({ entered, ...block }) => ({ ...block, crossings: entered.map((test) => ({ test, distance: 0 })) })),
    })),
  }, owners) }));
  const { sections } = await landCases(at, {}, root, [{ path: shard, coverage: { tests: files.map((file) => ({ file, complete: true })) } }]);
  writeFileSync(at, withCaseSections(readFileSync(at), sections));
  return root;
}
