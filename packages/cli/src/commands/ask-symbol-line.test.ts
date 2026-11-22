import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { encodeExecutionIndex, landCases, testCoverageFile, withCaseSections, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/**
 * `variance ask symbol --line`, through the command a person types: the
 * declaration a line ran is the one whose tests are the line's tests.
 *
 * `useSessionId` is declared four times. `page` calls the one in `session.ts`,
 * no test enters the one in `stale.ts`, the one in `constant.ts` is a string, not a function, `header` is rendered by a test that
 * enters none, and `idle` is run by nobody. `format` is declared three times, once as `shout` exported under its name, and all are entered by the same test;
 * `log` is declared twice, one entered by every test. `token` is an arrow
 * whose parameters open below its name, a method of `Store`, and a string
 * above a block that declares an arrow of its name, each entered by `page`'s test.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-symbol-line-cache-')));
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

describe('variance ask symbol --line', () => {
  it('names the declaration the line called first, those its tests never entered as not run with it, in place order, and a constant as not in the recording', async () => {
    await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 10)).toEqual([
      '`useSessionId` at src/page.ts:3, by the 1 recorded test that ran the line:',
      '',
      'src/session.ts:1  1.00  1 of the 1 test that entered it ran the line',
      '',
      'Not run with it:',
      'src/legacy.ts:1  none of the 1 test that entered it ran the line',
      'src/stale.ts:1  no recorded test entered it',
      '',
      'Not in the recording:',
      'src/constant.ts:1  no recorded function is written at this line',
    ]);
  });

  it('reads each line where the recording ran it, and sets apart a declaration written since', async () => {
    const root = await recorded();
    writeFileSync(join(root, 'src/session.ts'), `// moved down\n\n${readFileSync(join(root, 'src/session.ts'), 'utf8')}`);
    writeFileSync(join(root, 'src/late.ts'), "export function useSessionId(): string {\n  return 'late';\n}\n");
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'since'], { cwd: root });
    expect(await main(['index'], { out: () => {}, err: () => {} })).toBe(EXIT_CLEAN);

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out).toContain('src/session.ts:3  1.00  1 of the 1 test that entered it ran the line');
    expect(answered.out).toContain('Written since the recording ran:\nsrc/late.ts:1');
  });

  it('scores nothing when the recording names no commit, and names the declarations as it would without the line', async () => {
    await recorded({ commit: false });

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')[0]).toBe('The recording cannot place src/page.ts:3: the recording names no commit, so nothing tells the declarations of `useSessionId` apart:');
    expect(answered.out).not.toContain('1.00');
    expect(answered.out).toContain('src/session.ts:1');
    expect(answered.out).toContain('src/legacy.ts:1');
  });

  it('refuses a line it cannot place at the recording\'s commit', async () => {
    await recorded({ commit: 'f'.repeat(40) });

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')[0]).toBe('The recording cannot place src/page.ts:3: git could not diff it against commit ffffffffffff, so nothing tells the declarations of `useSessionId` apart:');
  });

  it('says a line written since the recording ran tells nothing apart', async () => {
    const root = await recorded();
    writeFileSync(join(root, 'src/fresh.ts'), "import { useSessionId } from './session';\nexport const fresh = (): string => useSessionId();\n");
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'since'], { cwd: root });
    expect(await main(['index'], { out: () => {}, err: () => {} })).toBe(EXIT_CLEAN);

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/fresh.ts:2']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')[0]).toBe('The recording cannot place src/fresh.ts:2: the line was written since the recording ran, so nothing tells the declarations of `useSessionId` apart:');
  });

  it('refuses a line outside the checkout', async () => {
    const root = await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', '../elsewhere.ts:1']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')[0]).toBe(`The recording cannot place ../elsewhere.ts:1: ../elsewhere.ts is outside the checkout at ${root}, and the recording holds only paths inside it, so nothing tells the declarations of \`useSessionId\` apart:`);
  });

  it('says no recording holds a suite when nothing was recorded', async () => {
    const root = await recorded({ recording: false });

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')[0]).toBe(`No recording under ${root} holds a suite, so nothing tells the declarations of \`useSessionId\` apart:`);
  });

  it('refuses a line spelled without its number', async () => {
    await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err.split('\n')[0]).toBe('`--line` takes `<file>:<line>`, such as `src/page.ts:3`, not `src/page.ts`');
  });

  it('names declarations entered by the same tests as tied, one exported under another name by the function its file names', async () => {
    await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'format', '--line', 'src/use.ts:2']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 5)).toEqual([
      '`format` at src/use.ts:2, by the 1 recorded test that ran the line:',
      '',
      'src/a.ts:1  1.00 tied  1 of the 1 test that entered it ran the line',
      'src/b.ts:1  1.00 tied  1 of the 1 test that entered it ran the line',
      'src/c.ts:1  1.00 tied  1 of the 1 test that entered it ran the line',
    ]);
  });

  it('says no test ran the line, and names the declarations as it would without it', async () => {
    await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/idle.ts:2']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')[0]).toBe('No recorded test ran src/idle.ts:2, so nothing tells the declarations of `useSessionId` apart:');
    expect(answered.out).toContain('src/session.ts:1');
    expect(answered.out).toContain('src/legacy.ts:1');
  });

  it('ranks a declaration only the line\'s tests entered above one every test entered', async () => {
    await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'log', '--line', 'src/report.ts:2']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 4)).toEqual([
      '`log` at src/report.ts:2, by the 1 recorded test that ran the line:',
      '',
      'src/quiet.ts:1  1.00  1 of the 1 test that entered it ran the line',
      'src/log.ts:1  0.45  1 of the 5 tests that entered it ran the line',
    ]);
  });

  it('scores a method by its class and an arrow opening below its name, and leaves a constant above a namesake in a block unscored', async () => {
    await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'token', '--line', 'src/page.ts:3']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 7)).toEqual([
      '`token` at src/page.ts:3, by the 1 recorded test that ran the line:',
      '',
      'src/arrow.ts:1  1.00 tied  1 of the 1 test that entered it ran the line',
      'src/store.ts:2  1.00 tied  1 of the 1 test that entered it ran the line',
      '',
      'Not in the recording:',
      'src/fixed.ts:1  no recorded function is written at this line',
    ]);
  });
});

/**
 * Five tests, each named for what it renders, recorded at the commit the
 * sources are written at, at `commit` when it names one, at none when it is
 * false, and not recorded at all when `recording` is false.
 */
async function recorded({ commit = true, recording = true }: { readonly commit?: boolean | string; readonly recording?: boolean } = {}): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-symbol-line-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
  const declares = (name: string, value: string): string => `export function ${name}(): string {\n  return '${value}';\n}\n`;
  const sources: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'resonance', private: true }),
    'src/session.ts': declares('useSessionId', 'real'),
    'src/legacy.ts': declares('useSessionId', 'legacy'),
    'src/stale.ts': declares('useSessionId', 'stale'),
    'src/constant.ts': `export const useSessionId = 'constant';\n${declares('other', 'other')}`,
    'src/page.ts': [
      "import { useSessionId } from './session';",
      'export function page(): string {',
      '  return useSessionId();',
      '}',
      'export function header(): string {',
      '  return useSessionId();',
      '}',
      '',
    ].join('\n'),
    'src/idle.ts': "import { useSessionId } from './session';\nexport function idle(): string {\n  return useSessionId();\n}\n",
    'src/a.ts': declares('format', 'a'),
    'src/b.ts': declares('format', 'b'),
    'src/c.ts': "function shout(): string {\n  return 'c';\n}\nexport { shout as format };\n",
    'src/use.ts': "import { format } from './a';\nexport const used = (): string => format();\n",
    'src/log.ts': declares('log', 'loud'),
    'src/quiet.ts': declares('log', 'quiet'),
    'src/report.ts': "import { log } from './quiet';\nexport const report = (): string => log();\n",
    'src/arrow.ts': "export const token =\n  (): string => 'arrow';\n",
    'src/store.ts': "export class Store {\n  token(): string {\n    return 'method';\n  }\n}\n",
    'src/fixed.ts': "export const token = 'fixed';\n{\n  const token = (): string => 'inner';\n  void token;\n}\n",
  };
  for (const [path, text] of Object.entries(sources)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('add', '.');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'recorded');
  // A question reads the generation `variance index` published.
  expect(await main(['index'], { out: () => {}, err: () => {} })).toBe(EXIT_CLEAN);
  if (!recording) return root;
  const at = testCoverageFile(root);
  const files = ['test/page.test.ts', 'test/legacy.test.ts', 'test/header.test.ts', 'test/use.test.ts', 'test/report.test.ts'];
  const region = (kind: string, name: string, startLine: number, endLine: number, entered: readonly number[]) => ({
    kind, name, path: 'entry', startLine, endLine, source: true, crossings: entered.map((test) => ({ test, distance: 0 })),
  });
  const modules: Record<string, ReturnType<typeof region>[]> = {
    'src/session.ts': [region('function', 'useSessionId', 1, 3, [0])],
    'src/legacy.ts': [region('function', 'useSessionId', 1, 3, [1])],
    'src/stale.ts': [region('function', 'useSessionId', 1, 3, [])],
    'src/constant.ts': [region('function', 'other', 2, 4, [])],
    'src/page.ts': [region('function', 'page', 2, 4, [0]), region('function', 'header', 5, 7, [2])],
    'src/idle.ts': [region('function', 'idle', 2, 4, [])],
    'src/a.ts': [region('function', 'format', 1, 3, [3])],
    'src/b.ts': [region('function', 'format', 1, 3, [3])],
    'src/c.ts': [region('function', 'shout', 1, 3, [3])],
    'src/use.ts': [region('function', 'used', 2, 2, [3])],
    'src/log.ts': [region('function', 'log', 1, 3, [0, 1, 2, 3, 4])],
    'src/quiet.ts': [region('function', 'log', 1, 3, [4])],
    'src/report.ts': [region('function', 'report', 2, 2, [4])],
    'src/arrow.ts': [region('function', 'token', 2, 2, [0])],
    'src/store.ts': [region('function', 'Store/token', 2, 4, [0])],
    'src/fixed.ts': [region('function', 'token', 3, 3, [0])],
  };
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
    ...(commit === false ? {} : { commit: commit === true ? git('rev-parse', 'HEAD') : commit }),
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: Object.entries(modules).map(([file, blocks]) => covered(file, blocks)),
  });
  const tests = files.map((file, at) => ({ id: `t${at}`, file, name: `renders ${file.slice(5, -8)}` }));
  const shard = join(mkdtempSync(join(tmpdir(), 'va-symbol-line-shard-')), 'run.bin');
  writeFileSync(shard, withCaseSections(readFileSync(at), { index: encodeExecutionIndex({
    tests,
    modules: Object.entries(modules).map(([file, blocks]) => ({ file, blocks })),
  }) }));
  const { sections } = await landCases(at, {}, root, [{ path: shard, coverage: { tests: files.map((file) => ({ file, complete: true })) } }]);
  writeFileSync(at, withCaseSections(readFileSync(at), sections));
  return root;
}
