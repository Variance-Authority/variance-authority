import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeExecutionIndex, landCases, testCoverageFile, withCaseSections, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/** `variance ask test-composition`, through the command a person types. */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-test-composition-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance ask test-composition', () => {
  it('asks for the test file when none is named', async () => {
    await recorded();
    const answered = await run(['ask', 'test-composition']);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('--file');
  });

  it('answers a test with its piece and the layer only it enters', async () => {
    await recorded();

    const answered = await run(['ask', 'test-composition', '--file', 'test/order.test.ts', '--name', 'pays']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')).toEqual([
      'test/order.test.ts  pays for an order: 2 regions of its own.',
      '',
      'Pieces, smaller tests inside it, most shared first:',
      '  test/price.test.ts  prices  (1 of its 1 region inside it)',
      '',
      'Pieces entered 1 of its 2 regions. The other 1 no piece entered:',
      'Its own layer, in modules no piece entered:',
      '  src/order.ts:1-5  function',
      '',
    ]);
  });

  it('names the tests of the file when the name chooses none', async () => {
    await recorded();

    const answered = await run(['ask', 'test-composition', '--file', 'test/order.test.ts', '--name', 'refunds']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('No recorded test in test/order.test.ts has refunds in its name. Its 1 recorded test:\n  pays for an order');
  });
});

/**
 * A recording of four tests: `prices` enters `src/price.ts`, `pays for an
 * order` enters it and `src/order.ts`, and two more enter neither, so nothing
 * is structure.
 */
async function recorded(): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-test-composition-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
  const at = testCoverageFile(root);
  const files = ['test/price.test.ts', 'test/order.test.ts', 'test/idle.test.ts'];
  const module = (file: string, entered: readonly number[]) => ({
    file,
    sourceDigest: `digest:${file}`,
    instrumented: true,
    blocks: [{ ordinal: 0, kind: 'function', digest: `block:${file}`, name: '', path: 'entry', source: true, startLine: 1, endLine: 5, testFiles: entered.map((test) => files[Math.min(test, 2)] ?? '') }],
  });
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [module('src/price.ts', [0, 1]), module('src/order.ts', [1])],
  });
  const tests = [
    { id: 'p', file: files[0] ?? '', name: 'prices' },
    { id: 'o', file: files[1] ?? '', name: 'pays for an order' },
    { id: 'i1', file: files[2] ?? '', name: 'idles' },
    { id: 'i2', file: files[2] ?? '', name: 'idles again' },
  ];
  const block = (entered: readonly number[]) => ({
    kind: 'function', name: '', path: 'entry', startLine: 1, endLine: 5, source: true, crossings: entered.map((test) => ({ test, distance: 0 })),
  });
  const shard = join(mkdtempSync(join(tmpdir(), 'va-test-composition-shard-')), 'run.bin');
  writeFileSync(shard, withCaseSections(readFileSync(at), { index: encodeExecutionIndex({
    tests,
    modules: [{ file: 'src/price.ts', blocks: [block([0, 1])] }, { file: 'src/order.ts', blocks: [block([1])] }],
  }) }));
  const { sections } = landCases(at, {}, root, [{ path: shard, coverage: { tests: files.map((file) => ({ file, complete: true })) } }]);
  writeFileSync(at, withCaseSections(readFileSync(at), sections));
}
