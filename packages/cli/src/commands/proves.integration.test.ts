import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { instrumentationId } from '@variance-authority/sense/instrument';
import { encodeAsSetExecutionIndex, landCases, sourceCut, testCoverageFile, withCaseSections, writeTestCoverage } from '@variance-authority/sense/test-selection';
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

const MANY = Array.from({ length: 21 }, (_, at) => `f${String(at).padStart(2, '0')}`);

const SOURCES: Record<string, string> = {
  'src/total.mjs': 'export function total(a, b) {\n  return a + b;\n}\n',
  'src/log.mjs': 'export const log = (line) => {\n  globalThis.lines = [...(globalThis.lines ?? []), line];\n};\n',
  'src/ready.mjs': 'export function ready() {\n  return true;\n}\n',
  // The test: it logs, and asserts only the total.
  'test/total.check.mjs':
    "import { log } from '../src/log.mjs';\nimport { total } from '../src/total.mjs';\nlog('adding');\nif (total(2, 3) !== 5) process.exit(1);\n",
  'test/broken.check.mjs': 'process.exit(1);\n',
  // A test that waits on `ready`: emptied, it never returns true.
  'test/wait.check.mjs': "import { ready } from '../src/ready.mjs';\nwhile (!ready()) {}\n",
  // One more function than one ask breaks, each on its own line, and a test that calls them all.
  'src/many.mjs': MANY.map((name) => `export function ${name}() { return 0; }\n`).join(''),
  'test/many.check.mjs': `import * as many from '../src/many.mjs';\n${MANY.map((name) => `many.${name}();\n`).join('')}`,
  // A branch the test enters and does not assert, and a continuation it does.
  'src/sign.mjs': 'export function sign(n) {\n  if (n < 0) {\n    return -1;\n  }\n  return 1;\n}\n',
  'test/sign.check.mjs': "import { sign } from '../src/sign.mjs';\nsign(-2);\nif (sign(5) !== 1) process.exit(1);\n",
  // Two callbacks the walk names alike: the test reads what the first returns, and only how many the second does.
  'src/both.mjs': 'export function both(xs) {\n  const up = xs.map((x) => x + 1);\n  const down = xs.map((x) => x - 1);\n  return up[0] + down.length;\n}\n',
  'test/both.check.mjs': "import { both } from '../src/both.mjs';\nif (both([1]) !== 3) process.exit(1);\n",
};

/** The tests that entered each region, by the region's name and path as the walk cuts the file. */
const ENTERED: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>> = {
  'src/both.mjs': { 'both entry': [5], 'both/map.arg0 entry': [5] },
  'src/log.mjs': { 'log entry': [0] },
  'src/many.mjs': Object.fromEntries(MANY.map((name) => [`${name} entry`, [3]])),
  'src/ready.mjs': { 'ready entry': [2] },
  'src/sign.mjs': { 'sign entry': [4], 'sign if#0/then': [4], 'sign if#0/after': [4] },
  'src/total.mjs': { 'total entry': [0, 1] },
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
      'A survivor is an assertion that does not read the region, or a break that changes nothing the test can observe, such as code its break is equivalent to: this run cannot tell which.',
      '',
    ]);
    expect(snapshot(root)).toEqual(before);
  });

  it('breaks a region where it stands now, in a file edited since the recording', async () => {
    const root = await recorded();
    writeFileSync(join(root, 'src/total.mjs'), `// written since\n\n${SOURCES['src/total.mjs']}`);

    const answered = await run(['proves', '--file', 'test/total.check.mjs', '--name', 'adds', '--', process.execPath, 'test/total.check.mjs']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out).toContain('Noticed, the test failed with the region broken:\n  src/total.mjs:3-5  function total  returns nothing\n');
  });

  it('leaves unbroken a region whose source changed since the recording, which the record says nothing about', async () => {
    const root = await recorded();
    writeFileSync(join(root, 'src/total.mjs'), SOURCES['src/total.mjs']!.replace('a + b', 'b + a'));

    const answered = await run(['proves', '--file', 'test/total.check.mjs', '--name', 'adds', '--', process.execPath, 'test/total.check.mjs']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out).not.toContain('Noticed');
    expect(answered.out).toContain('Not broken:\n  src/total.mjs:1-3  function total  its source changed since the recording, so the record says nothing about it as it is now\n');
  });

  it('skips a branch and a continuation the test entered, and names the branch it does not assert', async () => {
    await recorded();

    const answered = await run(['proves', '--file', 'test/sign.check.mjs', '--name', 'signs', '--', process.execPath, 'test/sign.check.mjs']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out).toContain('Survived, the test passed with the region broken:\n  src/sign.mjs:2-4');
    expect(answered.out).toMatch(/Noticed, the test failed with the region broken:\n {2}src\/sign\.mjs:1-6 [^\n]*returns nothing\n {2}src\/sign\.mjs:5 [^\n]*skipped\n/);
  });

  it('tells apart two regions the walk names alike by what each holds', async () => {
    await recorded();

    const answered = await run(['proves', '--file', 'test/both.check.mjs', '--name', 'maps both', '--', process.execPath, 'test/both.check.mjs']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out).toMatch(/Survived, the test passed with the region broken:\n {2}src\/both\.mjs:3 [^\n]*returns nothing\n\n/);
    expect(answered.out).toMatch(/Noticed, the test failed with the region broken:\n(?: {2}[^\n]*\n)*? {2}src\/both\.mjs:2 [^\n]*returns nothing\n/);
    expect(answered.out).not.toContain('Not broken');
  });

  it('stops a break the test is still running at its deadline, and names it hung', async () => {
    await recorded();

    const answered = await run(['proves', '--file', 'test/wait.check.mjs', '--name', 'waits', '--', process.execPath, 'test/wait.check.mjs']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 5)).toEqual([
      'test/wait.check.mjs  waits',
      '',
      'Hung, the test was still running at its deadline with the region broken, and was stopped:',
      '  src/ready.mjs:1-3  function ready  returns nothing',
      '',
    ]);
  });

  it('breaks no more than its cap of regions, and counts the ones past it', async () => {
    await recorded();

    const answered = await run(['proves', '--file', 'test/many.check.mjs', '--name', 'calls', '--', process.execPath, 'test/many.check.mjs']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out).toContain('  src/many.mjs:20  function f19  returns nothing\n\nNot broken:\n  1 more region the test entered was not tried: one ask breaks at most 20, fewest other tests first\n');
  });

  it('refuses a checkout whose configuration names a cache root, which the runs would record into', async () => {
    const root = await recorded({ 'variance.config.json': JSON.stringify({ cacheRoot: '.variance/cache' }) });
    const before = snapshot(root);

    const answered = await run(['proves', '--file', 'test/total.check.mjs', '--name', 'adds', '--', process.execPath, 'test/total.check.mjs']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('names a cache root');
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
 * A checkout, committed and recorded at that commit with the regions the walk
 * cuts each file into: `adds` entered `total` and `log`, `adds again` entered
 * `total` too, `waits` entered `ready`, `calls` entered each of `MANY`, and
 * `signs` entered `sign`, its `if` and what follows it, and `maps both` entered `both` and its two callbacks. `extra` files are written beside them first.
 */
async function recorded(extra: Readonly<Record<string, string>> = {}): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-proves-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  for (const [file, text] of Object.entries({ ...SOURCES, ...extra })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('add', '.');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'recorded');
  process.chdir(root);
  const at = testCoverageFile(root);
  const tests = [
    { id: 'a', file: 'test/total.check.mjs', name: 'adds' },
    { id: 'o', file: 'test/other.check.mjs', name: 'adds again' },
    { id: 'w', file: 'test/wait.check.mjs', name: 'waits' },
    { id: 'm', file: 'test/many.check.mjs', name: 'calls' },
    { id: 's', file: 'test/sign.check.mjs', name: 'signs' },
    { id: 'b', file: 'test/both.check.mjs', name: 'maps both' },
  ];
  const files = tests.map(({ file }) => file);
  const fileOf = (test: number) => tests[test]?.file ?? '';
  const modules = Object.entries(ENTERED).map(([file, entered]) => {
    const cut = sourceCut(SOURCES[file]!, join(root, file), 'presence')!;
    return { file, sourceDigest: cut.sourceDigest, rows: cut.rows.map((row) => ({ row, entered: entered[`${row.name} ${row.path}`] ?? [] })) };
  });
  const none = 0xffffffff;
  const owners = modules.map(({ rows }) => Uint32Array.from(rows, ({ row }) => row.owner ?? none));
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: instrumentationId('presence'),
    commit: git('rev-parse', 'HEAD'),
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: modules.map(({ file, sourceDigest, rows }) => ({
      file,
      sourceDigest,
      instrumented: true,
      blocks: rows.map(({ row, entered }) => ({ ...row, testFiles: [...new Set(entered.map(fileOf))] })),
    })),
  });
  const shard = join(mkdtempSync(join(tmpdir(), 'va-proves-shard-')), 'run.bin');
  writeFileSync(shard, withCaseSections(readFileSync(at), { index: encodeAsSetExecutionIndex({
    tests,
    modules: modules.map(({ file, rows }) => ({
      file,
      blocks: rows.map(({ row: { kind, name, path, startLine, endLine, source }, entered }) => ({ kind, name, path, startLine, endLine, source, crossings: entered.map((test) => ({ test, distance: 0 })) })),
    })),
  }, owners) }));
  const { sections } = await landCases(at, {}, root, [{ path: shard, coverage: { tests: files.map((file) => ({ file, complete: true })) } }]);
  writeFileSync(at, withCaseSections(readFileSync(at), sections));
  return root;
}
