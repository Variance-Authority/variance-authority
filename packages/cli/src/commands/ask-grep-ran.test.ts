import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeExecutionIndex, landCases, testCoverageFile, withCaseSections, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/** `variance ask grep --test`, through the command a person types. */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-grep-ran-cache-')));
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

describe('variance ask grep --test', () => {
  it('splits the lines a test ran from those in a branch it passed by, in the files it entered alone', async () => {
    await recorded();

    const answered = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/order.test.ts', '--name', 'pays']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    // The line after the answer names the generation it was read from.
    expect(answered.out.split('\n').slice(0, 10)).toEqual([
      'test/order.test.ts  pays for an order entered 1 recorded file; files no recording instruments were not searched.',
      '',
      '2 matching lines in 1 file.',
      '',
      'Ran:',
      "src/order.ts:3:    log('give up later');",
      '',
      'Not taken:',
      "src/order.ts:6:    throw new Error('give up now');",
      '  in branch src/order.ts:5-7 of pay, which it did not enter',
    ]);
  });

  it('marks a line ran when one of the arms sharing it was entered', async () => {
    await recorded();

    const answered = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/refund.test.ts', '--name', 'refunds']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 11)).toEqual([
      'test/refund.test.ts  refunds entered 2 recorded files; files no recording instruments were not searched.',
      '',
      '3 matching lines in 2 files.',
      '',
      'Ran:',
      "src/order.ts:6:    throw new Error('give up now');",
      "src/refund.ts:1:export const refund = (paid: boolean): string => (paid ? 'give up refund' : 'keep');",
      '',
      'Not taken:',
      "src/order.ts:3:    log('give up later');",
      '  in branch src/order.ts:2-4 of pay, which it did not enter',
    ]);
  });

  it('marks a line by the branch it opens, and a one-line guard by the branch it holds', async () => {
    await recorded();

    const answered = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/ship.test.ts']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 10)).toEqual([
      'test/ship.test.ts  ships entered 1 recorded file; files no recording instruments were not searched.',
      '',
      '2 matching lines in 1 file.',
      '',
      'Ran:',
      "src/ship.ts:4:  } else { note('give up slow');",
      '',
      'Not taken:',
      "src/ship.ts:9:export function check(bad: boolean): void { if (bad) { throw new Error('give up guard'); } }",
      '  in branch src/ship.ts:9-9 of check, which it did not enter; the rest of the line ran',
    ]);
  });

  it('reads a line of a file edited since the recording where it stood then', async () => {
    const root = await recorded();
    writeFileSync(join(root, 'src/order.ts'), `// give up: a note written since\n\n${readFileSync(join(root, 'src/order.ts'), 'utf8')}`);

    const answered = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/order.test.ts', '--name', 'pays']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 15)).toEqual([
      'test/order.test.ts  pays for an order entered 1 recorded file; files no recording instruments were not searched.',
      '',
      'src/order.ts changed since the recorded commit: each line is read where it stood then, and a region is named by its lines then.',
      '',
      '3 matching lines in 1 file.',
      '',
      'Ran:',
      "src/order.ts:5:    log('give up later');",
      '',
      'Not taken:',
      "src/order.ts:8:    throw new Error('give up now');",
      '  in branch src/order.ts:5-7 of pay, which it did not enter',
      '',
      'Written since the recording, so no test has run it:',
      'src/order.ts:1:// give up: a note written since',
    ]);
  });

  it('refuses a test the recording does not hold, with what it holds', async () => {
    await recorded();

    const answered = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/order.test.ts', '--name', 'ships']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('No recorded test in test/order.test.ts has ships in its name. Its 1 recorded test:\n  pays for an order');
  });

  it('refuses a test name without the test file it is a name in', async () => {
    await recorded();

    const answered = await run(['ask', 'grep', '--query', 'give up', '--from', 'src/order.ts', '--name', 'pays']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('`--name` picks a test in the `--test` file');
  });

  it('refuses a test beside a start point along the imports', async () => {
    await recorded();

    const answered = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/order.test.ts', '--from', 'src/order.ts']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('--test');
  });
});

/**
 * Three tests. `pays for an order` enters `pay` and its first branch; `refunds`
 * enters `pay`'s second branch and `src/refund.ts`, which spells the query too,
 * on a line two arms share, and which the first test never entered; `ships`
 * enters the else-branch of `src/ship.ts`, which opens on the line the
 * then-branch closes, and the one-line `check` but not the branch it holds.
 */
async function recorded(): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-grep-ran-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(
    join(root, 'src/order.ts'),
    [
      'export function pay(total: number): void {',
      '  if (total > 0) {',
      "    log('give up later');",
      '  }',
      '  else {',
      "    throw new Error('give up now');",
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(join(root, 'src/refund.ts'), "export const refund = (paid: boolean): string => (paid ? 'give up refund' : 'keep');\n");
  writeFileSync(
    join(root, 'src/ship.ts'),
    ['export function ship(fast: boolean): void {', '  if (fast) {', '    go();', "  } else { note('give up slow');", '    wait();', '    wait();', '  }', '}', "export function check(bad: boolean): void { if (bad) { throw new Error('give up guard'); } }", ''].join('\n'),
  );
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('add', '.');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'recorded');
  const at = testCoverageFile(root);
  const files = ['test/order.test.ts', 'test/refund.test.ts', 'test/ship.test.ts'];
  const region = (kind: string, name: string, startLine: number, endLine: number, entered: readonly number[]) => ({
    kind, name, path: 'entry', startLine, endLine, source: true, crossings: entered.map((test) => ({ test, distance: 0 })),
  });
  const order = [region('function', 'pay', 1, 8, [0, 1]), region('branch', '', 2, 4, [0]), region('branch', '', 5, 7, [1])];
  // Both arms of the ternary share line 1; `refunds` entered the first.
  const refund = [region('function', 'refund', 1, 1, [1]), region('branch', '', 1, 1, [1]), region('branch', '', 1, 1, [])];
  // `} else {` closes the then-branch and opens the else on line 4; `ships` entered only the else.
  // `check` is a one-line guard: `ships` entered the function and not its branch.
  const ship = [
    region('function', 'ship', 1, 8, [2]), region('branch', '', 2, 4, []), region('branch', '', 4, 7, [2]),
    region('function', 'check', 9, 9, [2]), region('branch', '', 9, 9, []),
  ];
  const covered = (file: string, blocks: readonly ReturnType<typeof region>[]) => ({
    file,
    sourceDigest: `digest:${file}`,
    instrumented: true,
    blocks: blocks.map((block, ordinal) => ({
      ordinal, kind: block.kind, digest: `block:${file}:${ordinal}`, name: block.name, path: block.path, source: true,
      startLine: block.startLine, endLine: block.endLine, testFiles: block.crossings.map(({ test }) => files[test] ?? ''),
    })),
  });
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    commit: git('rev-parse', 'HEAD'),
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [covered('src/order.ts', order), covered('src/refund.ts', refund), covered('src/ship.ts', ship)],
  });
  const tests = [
    { id: 'o', file: files[0] ?? '', name: 'pays for an order' },
    { id: 'r', file: files[1] ?? '', name: 'refunds' },
    { id: 's', file: files[2] ?? '', name: 'ships' },
  ];
  const shard = join(mkdtempSync(join(tmpdir(), 'va-grep-ran-shard-')), 'run.bin');
  writeFileSync(shard, withCaseSections(readFileSync(at), { index: encodeExecutionIndex({
    tests,
    modules: [{ file: 'src/order.ts', blocks: order }, { file: 'src/refund.ts', blocks: refund }, { file: 'src/ship.ts', blocks: ship }],
  }) }));
  const { sections } = landCases(at, {}, root, [{ path: shard, coverage: { tests: files.map((file) => ({ file, complete: true })) } }]);
  writeFileSync(at, withCaseSections(readFileSync(at), sections));
  return root;
}
