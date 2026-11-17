import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { instrumentationId } from '@variance-authority/sense/instrument';
import { encodeExecutionIndex, sourceCut, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { BUNDLE, BUNDLE_FUNCTIONS, BUNDLE_MAP, MAIN, MATH } from './session-input.fixture.js';

let cache: string;
let root: string;
let previous: string | undefined;
let record: string;

// The unit suite ran `add` from `src/math.test.ts` and nothing else. One
// session ran the bundle as Playwright saw it served; a second, under Node,
// ran it with `twice` never called.
beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-session-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  root = await mkdtemp(join(tmpdir(), 'variance-coverage-session-'));
  execFileSync('git', ['init', '--quiet', root]);
  await writeFile(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'src/math.ts'), MATH);
  await writeFile(join(root, 'src/main.ts'), MAIN);
  await writeFile(join(root, 'dist/main.js'), BUNDLE);
  await writeFile(join(root, 'dist/main.js.map'), JSON.stringify(BUNDLE_MAP));

  record = testCoverageFile(root, { suite: 'unit' });
  await writeRecord(record, 'presence');

  await writeFile(join(root, 'checkout.json'), JSON.stringify([
    { url: 'http://localhost:5173/main.js', scriptId: '1', source: BUNDLE, functions: BUNDLE_FUNCTIONS },
  ]));
  const node = join(root, 'node-coverage');
  await mkdir(node);
  const url = `file://${join(root, 'dist/main.js')}`;
  const unrun = BUNDLE_FUNCTIONS.map((each) => each.functionName === 'twice' ? { ...each, ranges: [{ ...each.ranges[0]!, count: 0 }] } : each);
  await writeFile(join(node, 'coverage-1-1-0.json'), JSON.stringify({
    result: [{ url, scriptId: '1', functions: unrun }],
    'source-map-cache': { [url]: { lineLengths: BUNDLE.split('\n').map((line) => line.length), data: BUNDLE_MAP, url: 'main.js.map' } },
  }));
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(cache, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

/**
 * A record in which the unit suite ran `add` from `src/math.test.ts` and nothing
 * else, cut under `mode`; `digestOf` gives a row another text than the checkout's.
 */
async function writeRecord(at: string, mode: 'presence' | 'loads' | string, digestOf: (name: string, digest: string) => string = (_, digest) => digest): Promise<void> {
  const cut = sourceCut(MATH, 'src/math.ts', 'presence')!;
  const rows = cut.rows.map((row) => ({ ...row, digest: digestOf(row.name, row.digest) }));
  const test = { id: 'u', file: 'src/math.test.ts', name: 'adds', stopped: false };
  const index = {
    tests: [test],
    modules: [{ file: 'src/math.ts', blocks: rows.map((row) => ({ ...row, source: true, crossings: row.name === 'add' ? [{ test: 0, distance: 1 }] : [] })) }],
  };
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: mode === 'presence' || mode === 'loads' ? instrumentationId(mode) : mode,
    tests: [{ file: test.file, complete: true, preconditions: [{ name: test.file, digest: 'source:test' }] }],
    modules: [{
      file: 'src/math.ts',
      sourceDigest: cut.sourceDigest,
      instrumented: true,
      blocks: rows.map((row) => ({ ...row, testFiles: row.name === 'add' ? [test.file] : [] })),
    }],
  }, { index: encodeExecutionIndex(index as Parameters<typeof encodeExecutionIndex>[0]) });
}

async function ask(argv: readonly string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

// Paths are the operator's, read from where the command runs, as `--against` is.
const SESSIONS = (): string[] => ['--session', `checkout=${join(root, 'checkout.json')}`, '--served', join(root, 'dist'), '--session', `node=${join(root, 'node-coverage')}`];

describe('`coverage --session`', () => {
  it('names, per function, the sessions that ran it, and lists what sessions ran that no case did', async () => {
    const answer = await ask(['coverage', '--root', root, ...SESSIONS(), '--format', 'json']);

    expect(answer.err).toBe('');
    expect(answer.code).toBe(0);
    const sessions = JSON.parse(answer.out).sessions;
    expect(sessions.names).toEqual(['checkout', 'node']);
    const math = sessions.files.find((file: { file: string }) => file.file === 'src/math.ts');
    expect(math.functions.map(({ name, sessions, testFiles }: { name: string; sessions: string[]; testFiles?: string[] }) => ({ name, sessions, testFiles }))).toEqual([
      { name: 'add', sessions: ['ran', 'ran'], testFiles: ['src/math.test.ts'] },
      { name: 'never', sessions: ['unknown', 'unknown'], testFiles: [] },
      { name: 'twice', sessions: ['ran', 'unrun'], testFiles: [] },
    ]);
    expect(sessions.untested).toEqual([{ file: 'src/math.ts', functions: [{ name: 'twice', startLine: 9, endLine: 9, sessions: ['checkout'] }] }]);
  });

  it('says it in text, under the suites', async () => {
    const answer = await ask(['coverage', '--root', root, ...SESSIONS()]);

    expect(answer.code).toBe(0);
    expect(answer.out).toContain('ran by a session, by no recorded case');
    expect(answer.out).toMatch(/src\/math\.ts\n\s+twice\s+9\s+checkout/);
  });

  it('says it in markdown, folded under one summary', async () => {
    const answer = await ask(['coverage', '--root', root, ...SESSIONS(), '--format', 'markdown']);

    expect(answer.code).toBe(0);
    expect(answer.out).toContain('<summary>🧭 Ran by a session, by no recorded case: 1 function</summary>');
    expect(answer.out).toContain('| checkout | 2 | 1 | 0 |\n| node | 1 | 2 | 0 |');
    expect(answer.out).toContain('| `src/math.ts` | `twice` | 9 | checkout |');
  });

  it('names every source a session ran that it sets beside no case, and why', async () => {
    // A directory whose name starts with `..` is still the checkout's.
    await mkdir(join(root, '..gen'));
    await mkdir(join(root, 'node_modules/dep'), { recursive: true });
    const plain = 'export function plain() {\n  return 1;\n}\nplain();\n';
    await writeFile(join(root, '..gen/plain.js'), plain);
    await writeFile(join(root, '..gen/bad.js'), 'function (');
    await writeFile(join(root, '..gen/broken.js'), 'function (');
    await writeFile(join(root, 'node_modules/dep/index.js'), 'export function dep() {}\n');
    const script = (path: string, source: string) => ({
      url: `http://localhost:5173/${path}`,
      scriptId: path,
      source,
      functions: [{ functionName: '', ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] }],
    });
    const away = await mkdtemp(join(tmpdir(), 'variance-away-'));
    await writeFile(join(away, 'away.js'), plain);
    await writeFile(join(root, 'plain.json'), JSON.stringify([
      { ...script('..gen/plain.js', plain), url: `file://${join(away, 'away.js')}` },
      script('..gen/plain.js', plain),
      script('..gen/bad.js', 'function ('),
      script('..gen/broken.js', 'export function broken() {}\n'),
      script('node_modules/dep/index.js', 'export function dep() {}\n'),
    ]));

    const answer = await ask(['coverage', '--root', root, '--session', `plain=${join(root, 'plain.json')}`, '--served', root, '--format', 'json']);

    expect(answer.err).toBe('');
    const sessions = JSON.parse(answer.out).sessions;
    expect(sessions.files.map((file: { file: string }) => file.file)).toEqual(['..gen/plain.js']);
    expect(sessions.each).toEqual([{
      name: 'plain',
      skipped: [],
      unplaced: [],
      uncut: [join(root, '..gen/bad.js')],
      outside: [join(away, 'away.js'), join(root, 'node_modules/dep/index.js')].sort(),
      stale: [],
      gone: [],
    }]);
    expect(sessions.uncut).toEqual(['..gen/broken.js']);

    const text = await ask(['coverage', '--root', root, '--session', `plain=${join(root, 'plain.json')}`, '--served', root]);
    expect(text.out).toContain(`plain could not cut 1 source: ${join(root, '..gen/bad.js')}`);
    expect(text.out).toContain(`plain ran 2 sources outside the checkout or in a dependency: ${[join(away, 'away.js'), join(root, 'node_modules/dep/index.js')].sort().join(', ')}`);
    expect(text.out).toContain('1 file a session ran could not be cut in the checkout\'s text: ..gen/broken.js');

    const markdown = await ask(['coverage', '--root', root, '--session', `plain=${join(root, 'plain.json')}`, '--served', root, '--format', 'markdown']);
    expect(markdown.out).toContain(`plain could not cut 1 source: ${join(root, '..gen/bad.js')}`);
    expect(markdown.out).toContain(`- plain ran 2 sources outside the checkout or in a dependency: ${[join(away, 'away.js'), join(root, 'node_modules/dep/index.js')].sort().join(', ')}`);
    await rm(away, { recursive: true, force: true });
    expect(markdown.out).toContain('1 file a session ran could not be cut in the checkout\'s text: ..gen/broken.js');
  });

  it('reads a source the map holds no text of only when it is no newer than the script built from it', async () => {
    // The map names its sources and keeps none of their text, as `tsc` writes it.
    const { sourcesContent: _, ...bare } = BUNDLE_MAP;
    await writeFile(join(root, 'dist/bare.js'), BUNDLE.replace('sourceMappingURL=main.js.map', 'sourceMappingURL=bare.js.map'));
    await writeFile(join(root, 'dist/bare.js.map'), JSON.stringify({ ...bare, sources: [...bare.sources, '../src/gone.ts'] }));
    const url = `file://${join(root, 'dist/bare.js')}`;
    const extension = 'chrome-extension://abc/inject.js';
    await writeFile(join(root, 'bare.json'), JSON.stringify({ result: [{ url, scriptId: '1', functions: BUNDLE_FUNCTIONS }, { url: extension, scriptId: '2', functions: [] }] }));
    const session = ['coverage', '--root', root, '--session', `bare=${join(root, 'bare.json')}`, '--format', 'json'];

    // Built before its sources were last written: they may hold other text than ran.
    await utimes(join(root, 'dist/bare.js'), new Date('2000-01-01'), new Date('2000-01-01'));
    const stale = JSON.parse((await ask(session)).out).sessions;
    expect(stale.files).toEqual([]);
    expect(stale.each[0].stale).toEqual([join(root, 'src/main.ts'), join(root, 'src/math.ts')]);
    const text = (await ask(session.slice(0, -2))).out;
    expect(text).toContain(`bare ran 2 sources edited since its build, whose text its map does not hold: ${join(root, 'src/main.ts')}, ${join(root, 'src/math.ts')}`);
    expect(text).toContain('bare mapped to 1 source not on this machine: ../src/gone.ts');
    expect(text).toContain(`bare skipped 1 script it could not place: ${extension}`);

    await utimes(join(root, 'dist/bare.js'), new Date(), new Date());
    const fresh = JSON.parse((await ask(session)).out).sessions;
    expect(fresh.each[0].stale).toEqual([]);
    expect(fresh.each[0].unplaced).toEqual(['../src/gone.ts']);
    expect(fresh.each[0].skipped).toEqual([extension]);
    expect(fresh.files.map((file: { file: string }) => file.file)).toEqual(['src/main.ts', 'src/math.ts']);
  });

  it('says how many functions a session ran that the record holds in another text', async () => {
    await writeRecord(record, 'presence', (name, digest) => name === 'twice' ? 'another' : digest);
    try {
      const answer = await ask(['coverage', '--root', root, ...SESSIONS()]);

      expect(answer.out).toContain('1 function ran that no case can be counted for: the record holds them in another text, or loaded their file unprobed');
      expect(answer.out).not.toMatch(/\btwice\s+9/);
    } finally {
      await writeRecord(record, 'presence');
    }
  });

  it('names, per session, the functions it ran that the checkout no longer holds, and none it only loaded', async () => {
    await writeFile(join(root, 'src/math.ts'), MATH.replace('twice', 'thrice'));
    try {
      const answer = await ask(['coverage', '--root', root, ...SESSIONS()]);

      expect(answer.out).toContain('  checkout ran 1 function the checkout no longer holds, removed or renamed since: twice in src/math.ts');
      // The node session loaded `twice` and never called it.
      expect(answer.out).not.toContain('  node ran 1 function the checkout no longer holds');
    } finally {
      await writeFile(join(root, 'src/math.ts'), MATH);
    }
  });

  it('refuses records it cannot name functions in, or that were cut in more than one mode', async () => {
    const other = await mkdtemp(join(tmpdir(), 'variance-session-modes-'));
    execFileSync('git', ['init', '--quiet', other]);
    await writeFile(join(other, 'variance.config.json'), JSON.stringify({ suites: { cut: { kind: 'unit' }, loads: { kind: 'unit' }, odd: { kind: 'unit' } } }));
    await writeRecord(testCoverageFile(other, { suite: 'cut' }), 'presence');
    await writeRecord(testCoverageFile(other, { suite: 'loads' }), 'loads');
    await writeRecord(testCoverageFile(other, { suite: 'odd' }), 'made-elsewhere');
    const run = (suite: readonly string[]) => ask(['coverage', '--root', other, ...suite, '--session', `checkout=${join(root, 'checkout.json')}`, '--served', join(root, 'dist')]);
    try {
      expect((await run([])).err).toContain('`--session` needs records cut in one instrumentation mode, and these were cut in several; count one `--suite` at a time.');
      expect((await run(['--suite', 'loads'])).err).toContain('`--session` names functions, and this record was cut by module loads alone; record with presence or entries instrumentation first.');
      expect((await run(['--suite', 'odd'])).err).toContain('`--session` names functions, and this record was made by `made-elsewhere`; record with presence or entries instrumentation first.');
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('refuses a session it cannot name, or `--served` with no session', async () => {
    for (const value of ['checkout', '=at.json', 'checkout=']) {
      expect((await ask(['coverage', '--root', root, '--session', value])).err).toContain(`\`--session\` takes <name>=<path>, not \`${value}\``);
    }
    expect((await ask(['coverage', '--root', root, '--session', 'a=x.json', '--session', 'a=y.json'])).err).toContain('two sessions are named `a`; give each its own name.');
    expect((await ask(['coverage', '--root', root, '--served', 'dist'])).err).toContain('`--served` places a session\'s scripts; pass `--session <name>=<path>` with it.');
  });

  it('leaves the record as it was: a session is never a case', async () => {
    const before = await readFile(record);
    await ask(['coverage', '--root', root, ...SESSIONS()]);

    expect(Buffer.compare(await readFile(record), before)).toBe(0);
  });
});
