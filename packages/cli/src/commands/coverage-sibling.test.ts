import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import type { Coverage } from './coverage.js';

type Index = Parameters<typeof encodeExecutionIndex>[0];

const UNIT = { id: 'u', file: 'src/plan.test.ts', name: 'plans', stopped: false };
const WIDE = { id: 'w', file: 'src/wide.test.ts', name: 'plans wide', stopped: false };

const BASE_TEXT = [
  'export function plan(xs: number[]) {',
  '  const a = xs.map((x) => x + 1);',
  '  const b = xs.map((x) => x * 2);',
  '  const c = xs.map((x) => x - 1);',
  '  return [a, b, c];',
  '}',
  '',
].join('\n');

// A `.map` callback written before the second, which no case calls. The second's cases changed too: a second test
// reaches it now, so its cases cannot say which sibling it is.
const NOW_TEXT = [
  'export function plan(xs: number[]) {',
  '  const a = xs.map((x) => x + 1);',
  '  const n = xs.map((x) => x % 2);',
  '  const b = xs.map((x) => x * 2);',
  '  const c = xs.map((x) => x - 1);',
  '  return [a, b, c];',
  '}',
  '',
].join('\n');

function region(name: string, startLine: number, endLine: number, tests: readonly number[]) {
  return {
    kind: 'function', name, path: 'entry', startLine, endLine, source: true,
    crossings: tests.map((test) => ({ test, distance: 0 })),
  };
}

const BASE: Index = {
  tests: [UNIT, WIDE],
  modules: [{
    file: 'src/plan.ts',
    blocks: [
      region('plan', 1, 6, [0]),
      region('plan/map.arg0', 2, 2, [0]),
      region('plan/map.arg0', 3, 3, [0]),
      region('plan/map.arg0', 4, 4, []),
    ],
  }],
};

// No region lost a case and none that had none gained one: the callback on line 3 is on line 4 and kept `UNIT`.
const NOW: Index = {
  tests: [UNIT, WIDE],
  modules: [{
    file: 'src/plan.ts',
    blocks: [
      region('plan', 1, 7, [0, 1]),
      region('plan/map.arg0', 2, 2, [0]),
      region('plan/map.arg0', 3, 3, []),
      region('plan/map.arg0', 4, 4, [0, 1]),
      region('plan/map.arg0', 5, 5, []),
    ],
  }],
};

let cache: string;
let previous: string | undefined;
let repo: string;
let base: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, encoding: 'utf8' }).trim();

async function record(at: string, index: Index, last?: { readonly commit: string; readonly files: readonly string[] }): Promise<void> {
  await mkdir(dirname(at), { recursive: true });
  const cases = { index: encodeExecutionIndex(index), ...(last === undefined ? {} : { last: Buffer.from(JSON.stringify(last)) }) };
  await writeTestCoverage(at, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, cases);
}

/** Publish the source index, the step CI runs before `coverage`, which under CI never builds one. */
async function publishIndex(): Promise<void> {
  const cwd = process.cwd();
  process.chdir(repo);
  try {
    const indexed = await ask(['index']);
    if (indexed.code !== 0) throw new Error(`variance index failed in ${repo}: ${indexed.err}`);
  } finally {
    process.chdir(cwd);
  }
}

async function ask(argv: readonly string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-coverage-sibling-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  repo = await mkdtemp(join(tmpdir(), 'variance-coverage-sibling-'));
  execFileSync('git', ['init', '--quiet', repo]);
  await writeFile(join(repo, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src/plan.ts'), BASE_TEXT);
  git('add', '.');
  git('commit', '--quiet', '-m', 'base');
  base = join(await mkdtemp(join(tmpdir(), 'variance-coverage-sibling-record-')), 'unit.bin');
  await record(base, BASE, { commit: git('rev-parse', 'HEAD'), files: [] });
  await writeFile(join(repo, 'src/plan.ts'), NOW_TEXT);
  await publishIndex();
  await record(testCoverageFile(repo, { suite: 'unit' }), NOW);
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(cache, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
  await rm(dirname(base), { recursive: true, force: true });
});

describe('coverage against a base an edit wrote a sibling into, before one whose cases changed', () => {
  it('pairs the displaced sibling with the region its lines moved to, so no region is lost or gained', async () => {
    const answer = await ask(['coverage', '--root', repo, '--suite', 'unit', '--against', base, '--format', 'json']);

    expect(answer.code).toBe(0);
    const change = (JSON.parse(answer.out) as Coverage).suites[0]!.base!.change;
    expect({ lost: change.lost, hidden: change.hidden, gained: change.gained, thinned: change.thinned }).toEqual({
      lost: 0, hidden: 0, gained: 0, thinned: 0,
    });
    expect(change.written).toEqual({ regions: 1, run: 0 });
    expect(change.deleted).toEqual({ regions: 0, run: 0 });
    expect(change.testFiles).toEqual([
      {
        file: 'src/wide.test.ts',
        entered: [expect.objectContaining({ name: 'plan', startLine: 1 }), expect.objectContaining({ name: 'plan/map.arg0', startLine: 4 })],
        left: [],
      },
    ]);
  });
});
