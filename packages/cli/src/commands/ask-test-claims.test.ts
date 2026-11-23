import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeExecutionIndex, landCases, testCoverageFile, withCaseSections, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/** `variance ask test-claims`, through the command a person types, over a recording a run without Eyes made. */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-test-claims-cache-')));
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

describe('variance ask test-claims', () => {
  it('asks for the test file when none is named', async () => {
    await recorded();
    const answered = await run(['ask', 'test-claims']);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('--file');
  });

  it('says what a test claims, runs, adds and passes by, and that this run recorded no step or assertion', async () => {
    await recorded();

    const answered = await run(['ask', 'test-claims', '--file', 'test/order.test.ts', '--name', 'pays for an order']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')).toEqual([
      'test/order.test.ts  pays for an order',
      '',
      'Claims:',
      '  its name: pays for an order',
      '  its steps and assertions are not recorded: the run kept no Eyes journal, which says nothing about whether the test makes any.',
      '',
      'Ran, the functions it entered:',
      '  src/order.ts  order',
      '  src/price.ts  price',
      '',
      'Adds:',
      '  runs the same regions as 1 other test, structure aside:',
      '    test/order.test.ts  pays again',
      '  pieces, smaller tests inside it: test/price.test.ts  prices',
      '  wholes, larger tests holding it: none',
      '  only this test enters: nothing',
      '',
      'Passed by, the regions of the functions it entered that it did not take:',
      '  src/order.ts:3-4  branch in order  taken by 1 other test: test/order.test.ts  refunds an order',
      '  src/price.ts:4  branch in price  no test takes it',
      '',
    ]);
  });

  it('names the tests of the file when the name chooses none', async () => {
    await recorded();

    const answered = await run(['ask', 'test-claims', '--file', 'test/order.test.ts', '--name', 'ships']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('No recorded test in test/order.test.ts has ships in its name.');
  });
});

/**
 * A recording of six tests over two functions, each with a branch. `prices`
 * enters `price` and its first branch; `pays for an order` and `pays again`
 * enter that and `order` as well; `refunds an order` enters `order` and its
 * branch; two more enter nothing, so no region is structure. The second branch
 * of `price` is entered by no test.
 */
async function recorded(): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-test-claims-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
  const at = testCoverageFile(root);
  const files = ['test/price.test.ts', 'test/order.test.ts', 'test/idle.test.ts'];
  const tests = [
    { id: 'p', file: files[0] ?? '', name: 'prices' },
    { id: 'o', file: files[1] ?? '', name: 'pays for an order' },
    { id: 'o2', file: files[1] ?? '', name: 'pays again' },
    { id: 'r', file: files[1] ?? '', name: 'refunds an order' },
    { id: 'i1', file: files[2] ?? '', name: 'idles' },
    { id: 'i2', file: files[2] ?? '', name: 'idles again' },
  ];
  const fileOf = (test: number) => tests[test]?.file ?? '';
  const region = (kind: string, name: string, startLine: number, endLine: number, entered: readonly number[]) => ({ kind, name, path: name, startLine, endLine, source: true, entered });
  const modules = [
    { file: 'src/price.ts', regions: [region('function', 'price', 1, 5, [0, 1, 2]), region('branch', 'price', 2, 3, [0, 1, 2]), region('branch', 'price', 4, 4, [])] },
    { file: 'src/order.ts', regions: [region('function', 'order', 1, 6, [1, 2, 3]), region('branch', 'order', 3, 4, [3])] },
  ];
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
  const shard = join(mkdtempSync(join(tmpdir(), 'va-test-claims-shard-')), 'run.bin');
  writeFileSync(shard, withCaseSections(readFileSync(at), { index: encodeExecutionIndex({
    tests,
    modules: modules.map(({ file, regions }) => ({
      file,
      blocks: regions.map(({ entered, ...block }) => ({ ...block, crossings: entered.map((test) => ({ test, distance: 0 })) })),
    })),
  }) }));
  const { sections } = await landCases(at, {}, root, [{ path: shard, coverage: { tests: files.map((file) => ({ file, complete: true })) } }]);
  writeFileSync(at, withCaseSections(readFileSync(at), sections));
}
