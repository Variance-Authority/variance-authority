import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  const cut = sourceCut(MATH, 'src/math.ts', 'presence')!;
  const test = { id: 'u', file: 'src/math.test.ts', name: 'adds', stopped: false };
  const index = {
    tests: [test],
    modules: [{
      file: 'src/math.ts',
      blocks: cut.rows.map((row) => ({ ...row, source: true, crossings: row.name === 'add' ? [{ test: 0, distance: 1 }] : [] })),
    }],
  };
  record = testCoverageFile(root, { suite: 'unit' });
  await writeTestCoverage(record, {
    version: 3,
    instrumentation: instrumentationId('presence'),
    tests: [{ file: test.file, complete: true, preconditions: [{ name: test.file, digest: 'source:test' }] }],
    modules: [{
      file: 'src/math.ts',
      sourceDigest: cut.sourceDigest,
      instrumented: true,
      blocks: cut.rows.map((row) => ({ ...row, testFiles: row.name === 'add' ? [test.file] : [] })),
    }],
  }, { index: encodeExecutionIndex(index as Parameters<typeof encodeExecutionIndex>[0]) });

  await writeFile(join(root, 'checkout.json'), JSON.stringify([
    { url: 'http://localhost:5173/main.js', scriptId: '1', source: BUNDLE, functions: BUNDLE_FUNCTIONS },
  ]));
  const node = join(root, 'node-coverage');
  await mkdir(node);
  const url = `file://${join(root, 'dist/main.js')}`;
  const unrun = BUNDLE_FUNCTIONS.map((each) => each.functionName === 'twice' ? { ...each, ranges: [{ ...each.ranges[0]!, count: 0 }] } : each);
  await writeFile(join(node, 'coverage-1-1-0.json'), JSON.stringify({
    result: [{ url, scriptId: '1', functions: unrun }],
    'source-map-cache': { [url]: { lineLengths: [], data: BUNDLE_MAP, url: 'main.js.map' } },
  }));
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(cache, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

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
    expect(answer.out).toContain('| checkout | 2 | 1 |\n| node | 1 | 2 |');
    expect(answer.out).toContain('| `src/math.ts` | `twice` | 9 | checkout |');
  });

  it('leaves the record as it was: a session is never a case', async () => {
    const before = await readFile(record);
    await ask(['coverage', '--root', root, ...SESSIONS()]);

    expect(Buffer.compare(await readFile(record), before)).toBe(0);
  });
});
