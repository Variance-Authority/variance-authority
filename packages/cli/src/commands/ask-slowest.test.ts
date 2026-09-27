import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/**
 * `variance ask slowest-tests`, through the command a person types: the
 * durations are the ones a recording holds, anywhere or somewhere, and a
 * checkout that never recorded one is told where the question looked.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['XDG_CACHE_HOME'] = mkdtempSync(join(tmpdir(), 'va-slowest-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['XDG_CACHE_HOME'];
});

function checkout(): string {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-slowest-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance ask slowest-tests', () => {
  it('lists the slowest recorded files up to the limit asked for', async () => {
    const root = checkout();
    const at = testCoverageFile(root);
    await writeTestCoverage(at, {
      version: 3,
      instrumentation: 'fixture-instrumentation',
      tests: [
        { file: 'test/fast.test.ts', complete: true, preconditions: [], duration: 12 },
        { file: 'test/slow.test.ts', complete: true, preconditions: [], duration: 2400 },
        { file: 'test/untimed.test.ts', complete: true, preconditions: [] },
      ],
      modules: [],
    });

    expect(await run(['ask', 'slowest-tests', '--limit', '1'])).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: [
        `Slowest recorded test files, as their runner reported them, from ${at}:`,
        '  2.4 s  test/slow.test.ts',
        '1 of 2 timed file(s) shown; 1 recorded file(s) have no duration.',
        '',
        `Slowest recorded test cases: none read from ${at}.cases.bin, nothing is recorded there. ` +
          'A recorded test run writes it.',
        '',
      ].join('\n'),
    });
  });

  it('says where it looked when this checkout has recorded nothing', async () => {
    const root = checkout();

    const answered = await run(['ask', 'slowest-tests']);

    expect(answered.code).toBe(EXIT_CLEAN);
    expect(answered.out).toBe(
      `Slowest recorded test files: none read from ${testCoverageFile(root)}, nothing is recorded there. ` +
        'A recorded test run writes it.\n\n' +
        `Slowest recorded test cases: none read from ${testCoverageFile(root)}.cases.bin, nothing is recorded there. ` +
        'A recorded test run writes it.\n',
    );
  });

  it('refuses a limit that is not a count of rows', async () => {
    checkout();

    const refused = await run(['ask', 'slowest-tests', '--limit', 'many']);

    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.out).toBe('');
  });
});

/** Two test files that enter different modules: `a` enters `src/format.ts`, `b` enters `src/other/read.ts`. */
async function twoModules(root: string): Promise<string> {
  const at = testCoverageFile(root);
  const block = (file: string, testFiles: readonly string[]) => ({
    file,
    sourceDigest: `digest:${file}`,
    instrumented: true,
    blocks: [{
      ordinal: 0, kind: 'module' as const, digest: `block:${file}`, name: '', path: 'entry', source: true,
      startLine: 1, endLine: 5, testFiles,
    }],
  });
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [
      { file: 'test/a.test.ts', complete: true, preconditions: [], duration: 300 },
      { file: 'test/b.test.ts', complete: true, preconditions: [], duration: 1500 },
    ],
    modules: [block('src/format.ts', ['test/a.test.ts']), block('src/other/read.ts', ['test/b.test.ts'])],
  });
  const crossed = (file: string, tests: readonly number[]) => ({
    file,
    blocks: [{
      kind: 'module' as const, name: '', path: 'entry', startLine: 1, endLine: 5, source: true,
      crossings: tests.map((test) => ({ test, distance: 0 })),
    }],
  });
  writeFileSync(`${at}.cases.bin`, encodeExecutionIndex({
    tests: [
      { id: 'a1', file: 'test/a.test.ts', name: 'writes', duration: 250 },
      { id: 'b1', file: 'test/b.test.ts', name: 'reads > twice', duration: 1400 },
    ],
    modules: [crossed('src/format.ts', [0]), crossed('src/other/read.ts', [1])],
  }));
  return at;
}

describe('variance ask slowest-tests, somewhere', () => {
  it('keeps only the tests the recording says entered the path given with `--to`', async () => {
    const root = checkout();
    const at = await twoModules(root);

    expect(await run(['ask', 'slowest-tests', '--to', 'src/format.ts'])).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: [
        `Slowest recorded test files, that entered src/format.ts, as their runner reported them, from ${at}:`,
        '  300 ms  test/a.test.ts',
        '1 of 1 timed file(s) shown.',
        '',
        `Slowest recorded test cases, that entered src/format.ts, as their runner reported them, from ${at}.cases.bin:`,
        '  250 ms  test/a.test.ts  writes',
        '1 of 1 timed case(s) shown.',
        '',
      ].join('\n'),
    });
    expect((await run(['ask', 'slowest-tests', '--to', 'src/other'])).out).toContain('  1.5 s  test/b.test.ts\n');
  });

  it('combines `--from` with `--to`, and says which half matched nothing', async () => {
    const root = checkout();
    const at = await twoModules(root);

    const answered = await run(['ask', 'slowest-tests', '--from', 'test/a.test.ts', '--to', 'src/other,src/format.ts']);

    expect(answered.out.split('\n').slice(0, 2)).toEqual([
      `Slowest recorded test files, under test/a.test.ts, that entered src/other or src/format.ts, ` +
        `as their runner reported them, from ${at}:`,
      '  300 ms  test/a.test.ts',
    ]);
    const empty = await run(['ask', 'slowest-tests', '--from', 'test/b.test.ts', '--to', 'src/format.ts']);
    expect(empty.out.split('\n')[0]).toBe(
      'Slowest recorded test files, under test/b.test.ts, that entered src/format.ts: ' +
        `no recorded file under test/b.test.ts entered src/format.ts, in ${at}.`,
    );
  });

  it('refuses a path in neither the recording nor the checkout, and names the nearest recorded one', async () => {
    const root = checkout();
    await twoModules(root);

    const refused = await run(['ask', 'slowest-tests', '--to', 'src/formt.ts']);

    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.out).toBe('');
    expect(refused.err).toContain('`src/formt.ts` is in neither the recording nor the files');
    expect(refused.err).toContain('Did you mean `src/format.ts`?');
  });
});
