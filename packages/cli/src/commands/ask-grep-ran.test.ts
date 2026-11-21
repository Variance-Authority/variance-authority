import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeExecutionIndex, landCases, testCoverageFile, withCaseSections, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { askSource } from './ask.js';

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
    // The answer first, rows in the one grammar, and what bounds them in trailing notes.
    expect(answered.out.split('\n').slice(0, 7)).toEqual([
      '2 matching lines in 1 of the 1 recorded file test/order.test.ts  pays for an order entered:',
      'Ran:',
      "src/order.ts:3: log('give up later');",
      'Not taken:',
      "src/order.ts:6: throw new Error('give up now');",
      '  in branch 5-7 of pay, which it did not enter',
      'note: files no recording instruments were not searched.',
    ]);
  });

  it('marks a line ran when one of the arms sharing it was entered', async () => {
    await recorded();

    const answered = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/refund.test.ts', '--name', 'refunds']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 8)).toEqual([
      '3 matching lines in 2 of the 2 recorded files test/refund.test.ts  refunds entered:',
      'Ran:',
      "src/order.ts:6: throw new Error('give up now');",
      "src/refund.ts:1: export const refund = (paid: boolean): string => (paid ? 'give up refund' : 'keep');",
      'Not taken:',
      "src/order.ts:3: log('give up later');",
      '  in branch 2-4 of pay, which it did not enter',
      'note: files no recording instruments were not searched.',
    ]);
  });

  it('marks a line by the branch it opens, a one-line guard by the branch it holds, and functions sharing a line side by side', async () => {
    await recorded();

    const answered = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/ship.test.ts']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 12)).toEqual([
      '4 matching lines in 1 of the 1 recorded file test/ship.test.ts  ships entered:',
      'Ran:',
      'src/ship.ts',
      "  4: } else { note('give up slow');",
      "  10: export function told(): void { note('give up told'); } export function untold(): void {}",
      'Not taken:',
      'src/ship.ts',
      "  9: export function check(bad: boolean): void { if (bad) { throw new Error('give up guard'); } }",
      '    in branch 9-9 of check, which it did not enter; the rest of the line ran',
      "  11: export function stop(late: boolean): void { if (late) { note('give up stop'); } }",
      '    in function stop 11-11, which it did not enter',
      'note: files no recording instruments were not searched.',
    ]);
  });

  it('searches a file the test entered without a match, and says when nothing matches', async () => {
    await recorded();

    const refund = await run(['ask', 'grep', '--query', 'refund', '--test', 'test/refund.test.ts']);
    const nowhere = await run(['ask', 'grep', '--query', 'nowhere', '--test', 'test/refund.test.ts']);

    expect([refund.code, refund.err, nowhere.code, nowhere.err]).toEqual([EXIT_CLEAN, '', EXIT_CLEAN, '']);
    expect(refund.out).toContain('1 matching line in 1 of the 2 recorded files test/refund.test.ts  refunds entered:');
    expect(nowhere.out.split('\n')[0]).toBe('Nothing in the 2 recorded files test/refund.test.ts  refunds entered matches `nowhere`.');
  });

  it('counts the lines the limit leaves out', async () => {
    await recorded();

    const answered = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/ship.test.ts', '--limit', '1']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out).toContain("Ran:\nsrc/ship.ts:4: } else { note('give up slow');\nnote: ");
    expect(answered.out).not.toContain('Not taken:');
    expect(answered.out).toContain('3 more not shown; `--offset` 1 shows the next 1.');
  });

  it('pages across its sections, so an offset past the ran lines starts in the ones not taken', async () => {
    await recorded();

    const answered = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/ship.test.ts', '--limit', '1', '--offset', '2']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out).toContain('Rows 3–3 of 4.');
    expect(answered.out).not.toContain('Ran:');
    expect(answered.out).toContain('Not taken:');
    expect(answered.out).toContain('1 more not shown; `--offset` 3 shows the next 1.');
  });

  it('names a file it could not read, and a file git could not diff against the recorded commit', async () => {
    const root = await recorded();
    rmSync(join(root, 'src/refund.ts'));
    rmSync(join(root, '.git'), { recursive: true });
    execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });

    const answered = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/refund.test.ts']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out).toContain('\nnote: ripgrep reported 1 error reading them; the first: ');
    expect(answered.out).toMatch(/^note: src\/order\.ts: .+, so each line is read where it stands now\.$/m);
  });

  it('answers a question intersected with another by the files the test entered', async () => {
    await recorded();

    const text = await askSource({ question: 'intersection', reports: ['grep --query give --test test/refund.test.ts', 'grep --query give --test test/order.test.ts'] });

    expect(text).toContain('1 file in all of them:');
    expect(text).toContain('src/order.ts —');
    expect(text).not.toContain('src/refund.ts —');
  });

  it('reads a line of a file edited since the recording where it stood then', async () => {
    const root = await recorded();
    writeFileSync(join(root, 'src/order.ts'), `// give up: a note written since\n\n${readFileSync(join(root, 'src/order.ts'), 'utf8')}`);

    const answered = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/order.test.ts', '--name', 'pays']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 10)).toEqual([
      '3 matching lines in 1 of the 1 recorded file test/order.test.ts  pays for an order entered:',
      'Ran:',
      "src/order.ts:5: log('give up later');",
      'Not taken:',
      "src/order.ts:8: throw new Error('give up now');",
      '  in branch 5-7 of pay, which it did not enter',
      'Written since the recording, so no test has run it:',
      'src/order.ts:1: // give up: a note written since',
      'note: files no recording instruments were not searched.',
      'note: src/order.ts changed since the recorded commit: each line is read where it stood then, and a region is named by its lines then.',
    ]);
  });

  it('refuses a test the recording does not hold, with what it holds', async () => {
    await recorded();

    const answered = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/order.test.ts', '--name', 'ships']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('No recorded test in test/order.test.ts has ships in its name. Its 1 recorded test:\n  pays for an order');
  });

  it('refuses a checkout with no recording, and a test file outside the checkout', async () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), 'va-grep-ran-bare-')));
    execFileSync('git', ['init', '--quiet'], { cwd: bare, stdio: 'pipe' });
    process.chdir(bare);
    expect(await main(['index'], { out: () => {}, err: () => {} })).toBe(EXIT_CLEAN);
    const unrecorded = await run(['ask', 'grep', '--query', 'give up', '--test', 'test/order.test.ts']);
    await recorded();
    const outside = await run(['ask', 'grep', '--query', 'give up', '--test', '../elsewhere.test.ts']);

    expect([unrecorded.code, outside.code]).toEqual([EXIT_OPERATOR, EXIT_OPERATOR]);
    expect(unrecorded.err).toContain('holds no suite to read');
    expect(outside.err).toContain('is outside the checkout');
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
 * then-branch closes, the one-line `check` but not the branch it holds, and
 * `told` but not `untold`, which shares its line, and not `stop`.
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
    ['export function ship(fast: boolean): void {', '  if (fast) {', '    go();', "  } else { note('give up slow');", '    wait();', '    wait();', '  }', '}', "export function check(bad: boolean): void { if (bad) { throw new Error('give up guard'); } }", "export function told(): void { note('give up told'); } export function untold(): void {}", "export function stop(late: boolean): void { if (late) { note('give up stop'); } }", ''].join('\n'),
  );
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('add', '.');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'recorded');
  // A question reads the generation `variance index` published.
  expect(await main(['index'], { out: () => {}, err: () => {} })).toBe(EXIT_CLEAN);
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
  // `told` and `untold` share line 10 side by side; `ships` entered `told`.
  // `stop` and the branch it holds on line 11 were never entered.
  const ship = [
    region('function', 'ship', 1, 8, [2]), region('branch', '', 2, 4, []), region('branch', '', 4, 7, [2]),
    region('function', 'check', 9, 9, [2]), region('branch', '', 9, 9, []),
    region('function', 'told', 10, 10, [2]), region('function', 'untold', 10, 10, []),
    region('function', 'stop', 11, 11, []), region('branch', '', 11, 11, []),
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
