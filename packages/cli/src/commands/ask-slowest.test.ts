import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeExecutionIndex, testCoverageFile, withCaseSections, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../bin.fixture.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/**
 * `variance ask slowest-tests`, through the command a person types: the
 * durations are the ones a recording holds, anywhere or somewhere, and a
 * checkout that never recorded one is told where the question looked.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-slowest-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
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
        `Read this checkout's own run, which names no commit, ${at}.`,
        '',
        'Slowest recorded test files, as their runner timed them:',
        '  2.4 s  test/slow.test.ts',
        '1 of 2 timed file(s) shown; 1 recorded file(s) have no duration.',
        '',
        `Slowest recorded test cases: none read from ${at}, no run kept its cases there.`,
        '',
      ].join('\n'),
    });
  });

  it('says where it looked when this checkout has recorded nothing', async () => {
    const root = checkout();

    const answered = await run(['ask', 'slowest-tests']);

    expect(answered.code).toBe(EXIT_CLEAN);
    expect(answered.out).toBe(
      `Slowest recorded test files: none read from ${testCoverageFile(root)}, nothing is recorded there.\n\n` +
        `Slowest recorded test cases: none read from ${testCoverageFile(root)}, no run kept its cases there.\n`,
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
  writeFileSync(at, withCaseSections(readFileSync(at), { index: encodeExecutionIndex({
    tests: [
      { id: 'a1', file: 'test/a.test.ts', name: 'writes', duration: 250, limit: 300 },
      { id: 'b1', file: 'test/b.test.ts', name: 'reads > twice', duration: 1400, limit: 60_000 },
    ],
    modules: [crossed('src/format.ts', [0]), crossed('src/other/read.ts', [1])],
  }) }));
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
        `Read this checkout's own run, which names no commit, ${at}.`,
        '',
        'Closest to their limit, that entered src/format.ts, each as run and limit:',
        '  250 ms of 300 ms  test/a.test.ts  writes',
        '1 of 1 limited case(s) shown.',
        '',
        'Slowest recorded test files, that entered src/format.ts, as their runner timed them:',
        '  300 ms  test/a.test.ts',
        '1 of 1 timed file(s) shown.',
        '',
        'Slowest recorded test cases, that entered src/format.ts, as their runner timed them:',
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

    expect(answered.out).toContain([
      'Slowest recorded test files, under test/a.test.ts, that entered src/other or src/format.ts, as their runner timed them:',
      '  300 ms  test/a.test.ts',
    ].join('\n'));
    const empty = await run(['ask', 'slowest-tests', '--from', 'test/b.test.ts', '--to', 'src/format.ts']);
    expect(empty.out).toContain(
      'Slowest recorded test files, under test/b.test.ts, that entered src/format.ts: ' +
        `no recorded file under test/b.test.ts entered src/format.ts, in ${at}.`,
    );
  });

  it('keeps the cases of a folder that ran at least the time given with `--over`, and leaves the files out', async () => {
    const root = checkout();
    await twoModules(root);

    const answered = await run(['ask', 'slowest-tests', '--over', '1s', '--from', 'test']);

    expect(answered.code).toBe(EXIT_CLEAN);
    expect(answered.out).toContain('  1.4 s  test/b.test.ts  reads > twice\n1 of 1 timed case(s) shown; 1 ran faster.\n');
    expect(answered.out).not.toContain('test files');
  });

  it('refuses an `--over` that is not a time', async () => {
    const root = checkout();
    await twoModules(root);

    const refused = await run(['ask', 'slowest-tests', '--over', 'soon']);

    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.err).toContain('`--over` takes a time such as `3s` or `500ms`; it was given `soon`.');
  });

  it('refuses a path in neither the recording nor the checkout, and names no other path', async () => {
    const root = checkout();
    await twoModules(root);

    const refused = await run(['ask', 'slowest-tests', '--to', 'src/formt.ts']);

    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.out).toBe('');
    expect(refused.err).toContain(
      `\`src/formt.ts\` is in neither the recording nor the files git lists under ${root}. Both name each file from the repository root.`,
    );
    expect(refused.err).not.toContain('src/format.ts');
  });

  it('answers a new file git lists as untracked and not ignored, rather than refusing it as a typo', async () => {
    const root = checkout();
    await twoModules(root);
    writeFileSync(join(root, 'new.ts'), 'export const added = 1;\n');

    const answered = await run(['ask', 'slowest-tests', '--to', 'new.ts']);

    expect(answered.code).toBe(EXIT_CLEAN);
    expect(answered.err).toBe('');
  });
});
