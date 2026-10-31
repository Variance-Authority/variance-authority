import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  commitRunsFile,
  encodeExecutionIndex,
  testCoverageFile,
  writeCommitRuns,
  writeTestCoverage,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import type { Coverage } from './coverage.js';

type Index = Parameters<typeof encodeExecutionIndex>[0];

const UNIT = { id: 'u', file: 'src/pay.test.ts', name: 'charges once', stopped: false };

const BASE_TEXT = [
  'export function pick(xs: number[]) {',
  '  const a = xs.filter((x) => x > 0);',
  '  const b = xs.filter((x) => x < 9);',
  '  return [a, b];',
  '}',
  '',
  'export function refund() {',
  '  return 1;',
  '}',
  '',
].join('\n');

// A third `.filter` callback written between the two, which no case calls.
const NOW_TEXT = [
  'export function pick(xs: number[]) {',
  '  const a = xs.filter((x) => x > 0);',
  '  const c = xs.filter((x) => x !== 5);',
  '  const b = xs.filter((x) => x < 9);',
  '  return [a, b];',
  '}',
  '',
  'export function refund() {',
  '  return 1;',
  '}',
  '',
].join('\n');

function region(name: string, startLine: number, endLine: number, called: boolean) {
  return {
    kind: 'function', name, path: 'entry', startLine, endLine, source: true,
    crossings: called ? [{ test: 0, distance: 0 }] : [],
  };
}

const BASE: Index = {
  tests: [UNIT],
  modules: [{
    file: 'src/pay.ts',
    blocks: [
      region('pick', 1, 5, true),
      region('pick/filter.arg0', 2, 2, true),
      region('pick/filter.arg0', 3, 3, true),
      region('refund', 7, 9, true),
    ],
  }],
};

// The two callbacks at the base still have the case they had; only `refund` lost its own.
const NOW: Index = {
  tests: [UNIT],
  modules: [{
    file: 'src/pay.ts',
    blocks: [
      region('pick', 1, 6, true),
      region('pick/filter.arg0', 2, 2, true),
      region('pick/filter.arg0', 3, 3, false),
      region('pick/filter.arg0', 4, 4, true),
      region('refund', 8, 10, false),
    ],
  }],
};

let cache: string;
let previous: string | undefined;
let repo: string;
let base: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, encoding: 'utf8' }).trim();

async function record(
  at: string,
  index: Index,
  last?: { readonly commit?: string; readonly files: readonly string[] },
  header: Pick<TestCoverage, 'commit' | 'tests'> = { tests: [] },
): Promise<void> {
  await mkdir(dirname(at), { recursive: true });
  const cases = { index: encodeExecutionIndex(index), ...(last === undefined ? {} : { last: Buffer.from(JSON.stringify(last)) }) };
  await writeTestCoverage(at, { version: 3, instrumentation: 'fixture-instrumentation', ...header, modules: [] }, cases);
}

/** Publish the source index, the step CI runs before `coverage`, which under CI never builds one. */
async function publishIndex(at = repo): Promise<void> {
  const cwd = process.cwd();
  process.chdir(at);
  try {
    const indexed = await ask(['index']);
    if (indexed.code !== 0) throw new Error(`variance index failed in ${at}: ${indexed.out}\n${indexed.err}`);
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
  cache = await mkdtemp(join(tmpdir(), 'variance-coverage-base-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  repo = await mkdtemp(join(tmpdir(), 'variance-coverage-base-'));
  execFileSync('git', ['init', '--quiet', repo]);
  await writeFile(join(repo, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src/pay.ts'), BASE_TEXT);
  git('add', '.');
  git('commit', '--quiet', '-m', 'base');
  base = join(await mkdtemp(join(tmpdir(), 'variance-coverage-base-record-')), 'unit.bin');
  await record(base, BASE, { commit: git('rev-parse', 'HEAD'), files: [] });
  await writeFile(join(repo, 'src/pay.ts'), NOW_TEXT);
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

describe('coverage against a base an edit wrote a sibling region into', () => {
  it('pairs each region with the one its lines moved to, so only the region that lost its case is lost', async () => {
    const answer = await ask(['coverage', '--root', repo, '--suite', 'unit', '--against', base, '--format', 'json']);

    expect(answer.code).toBe(0);
    const change = (JSON.parse(answer.out) as Coverage).suites[0]!.base!.change;
    expect({ lost: change.lost, hidden: change.hidden, gained: change.gained, thinned: change.thinned }).toEqual({
      lost: 1, hidden: 0, gained: 0, thinned: 0,
    });
    expect(change.written).toEqual({ regions: 1, run: 0 });
    expect(change.deleted).toEqual({ regions: 0, run: 0 });
    expect(change.testFiles).toEqual([
      { file: 'src/pay.test.ts', entered: [], left: [expect.objectContaining({ name: 'refund', startLine: 8 })] },
    ]);
  });
});

describe('coverage against a base, with the records made at a commit before the checkout\'s', () => {
  it('names the commit the records were made at apart from the base they are compared with', async () => {
    const later = await copyOf('later');
    const at = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: later, encoding: 'utf8' }).trim();
    at('commit', '--quiet', '-am', 'recorded');
    const recorded = at('rev-parse', 'HEAD');
    await record(testCoverageFile(later, { suite: 'unit' }), NOW, undefined, { commit: recorded, tests: [] });
    at('commit', '--quiet', '--allow-empty', '-m', 'since');
    await publishIndex(later);

    const answer = await ask(['coverage', '--root', later, '--suite', 'unit', '--against', base]);

    expect(answer.out.split('\n')[0]).toMatch(
      new RegExp(`^coverage at ${at('rev-parse', 'HEAD').slice(0, 8)}, recorded at ${recorded.slice(0, 8)}, against each suite's base — `, 'u'),
    );
  });
});

describe('coverage against a base whose commit it cannot diff from', () => {
  it('refuses a base recorded at a commit this clone does not have, and names how to fetch it', async () => {
    const absent = 'f'.repeat(40);
    const elsewhere = join(dirname(base), 'elsewhere.bin');
    await record(elsewhere, BASE, { commit: absent, files: [] });

    const answer = await ask(['coverage', '--root', repo, '--suite', 'unit', '--against', elsewhere, '--format', 'json']);

    expect(answer.code).toBe(2);
    expect(JSON.parse(answer.out)).toEqual({ refused: 'undiffed' });
    expect(answer.err).toContain(`was recorded at ${absent}, which this clone does not have`);
    expect(answer.err).toContain(`git fetch origin ${absent}`);
    expect(answer.err).toContain('fetch-depth: 0');
  });

  it('refuses a base that names no commit', async () => {
    const unnamed = join(dirname(base), 'unnamed.bin');
    await record(unnamed, BASE, { files: [] });

    const answer = await ask(['coverage', '--root', repo, '--suite', 'unit', '--against', unnamed, '--format', 'json']);

    expect(answer.code).toBe(2);
    expect(JSON.parse(answer.out)).toEqual({ refused: 'undiffed' });
    expect(answer.err).toContain('names no commit it was recorded at');
  });

  it('refuses a base when the root is in no git checkout', async () => {
    const loose = await copyOf('loose');
    await rm(join(loose, '.git'), { recursive: true, force: true });
    await publishIndex(loose);
    await record(testCoverageFile(loose, { suite: 'unit' }), NOW);

    const answer = await ask(['coverage', '--root', loose, '--suite', 'unit', '--against', base, '--format', 'json']);

    expect(answer.code).toBe(2);
    expect(JSON.parse(answer.out)).toEqual({ refused: 'undiffed' });
    expect(answer.err).toContain(`\`${loose}\` is not in a git checkout to diff from it`);
  });

  it('refuses a base whose commit this clone has without its tree, so git cannot diff from it', async () => {
    const torn = await copyOf('torn');
    const at = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: torn, encoding: 'utf8' }).trim();
    at('commit', '--quiet', '-am', 'now');
    // A partial clone that never fetched the base's tree, and has no remote to fetch it from now.
    const tree = at('rev-parse', `${at('rev-parse', 'HEAD~1')}^{tree}`);
    await rm(join(torn, '.git/objects', tree.slice(0, 2), tree.slice(2)));
    await publishIndex(torn);
    await record(testCoverageFile(torn, { suite: 'unit' }), NOW);

    const answer = await ask(['coverage', '--root', torn, '--suite', 'unit', '--against', base, '--format', 'json']);

    expect(answer.code).toBe(2);
    expect(JSON.parse(answer.out)).toEqual({ refused: 'undiffed' });
    expect(answer.err).toContain('git could not read the diff from it to the working tree');
  });
});

describe('coverage against a base, beside a runs record that cannot be read', () => {
  it('refuses, naming the record, rather than reading every carried case as run', async () => {
    const unread = await copyOf('unread');
    await publishIndex(unread);
    const current = testCoverageFile(unread, { suite: 'unit' });
    await record(current, NOW);
    const runs = commitRunsFile(current);
    await mkdir(runs, { recursive: true });

    const answer = await ask(['coverage', '--root', unread, '--suite', 'unit', '--against', base, '--format', 'json']);

    expect(answer.code).toBe(2);
    expect(answer.err).toContain(`the runs record at ${runs} could not be read`);
    expect(answer.err).toContain('a comparison that read it as absent would call a case no test ran no longer run');
  });
});

describe('coverage against a base, for a test file the runs place before the record and that is no longer on disk', () => {
  // `refund` is entered at the base by `src/gone.test.ts` alone. The run at H
  // ran only `src/pay.test.ts`, so the runs record places `gone` at the base's
  // commit, and the record dropped its case over the edit to `src/pay.ts`.
  const GONE = { id: 'g', file: 'src/gone.test.ts', name: 'refunds', stopped: false };
  const entered = (at: ReturnType<typeof region>, test: number) => ({ ...at, crossings: [{ test, distance: 0 }] });
  const CARRIED_BASE: Index = {
    tests: [UNIT, GONE],
    modules: [{ file: 'src/pay.ts', blocks: [region('pick', 1, 5, true), entered(region('refund', 7, 9, false), 1)] }],
  };
  const CARRIED_NOW: Index = {
    tests: [UNIT, GONE],
    modules: [{ file: 'src/pay.ts', blocks: [region('pick', 1, 6, true), region('refund', 8, 10, false)] }],
  };

  async function carried(onDisk: boolean) {
    const at = await copyOf(onDisk ? 'kept' : 'gone');
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: at, encoding: 'utf8' }).trim();
    const P = git('rev-parse', 'HEAD');
    git('commit', '--quiet', '-am', 'now');
    const H = git('rev-parse', 'HEAD');
    if (onDisk) await writeFile(join(at, GONE.file), "import './pay.js';\n");
    await publishIndex(at);
    const against = join(dirname(at), 'base.bin');
    await record(against, CARRIED_BASE, { commit: P, files: [] });
    const current = testCoverageFile(at, { suite: 'unit' });
    const tests = [UNIT.file, GONE.file].map((file) => ({ file, complete: true, preconditions: [] }));
    await record(current, CARRIED_NOW, undefined, { commit: H, tests });
    await writeCommitRuns(commitRunsFile(current), {
      commit: H,
      latest: '2026-01-02T00:00:00.000Z',
      runs: 1,
      landings: [{ files: [UNIT.file], first: '2026-01-02T00:00:00.000Z', latest: '2026-01-02T00:00:00.000Z', runs: 1 }],
      standing: [{ commit: P, files: [GONE.file] }],
    });
    const answer = await ask(['coverage', '--root', at, '--suite', 'unit', '--against', against, '--format', 'json']);
    expect(answer.code).toBe(0);
    return (JSON.parse(answer.out) as Coverage).suites[0]!.base!.change;
  }

  it('reads a carried case the record dropped as unmeasured while the test file is on disk', async () => {
    const change = await carried(true);

    expect({ lost: change.lost, unmeasured: change.unmeasured }).toEqual({ lost: 0, unmeasured: 1 });
    expect(change.testFiles).toEqual([]);
  });

  it('reads the region only it entered as lost once the test file is gone, and names the file as having left it', async () => {
    const change = await carried(false);

    expect({ lost: change.lost, unmeasured: change.unmeasured }).toEqual({ lost: 1, unmeasured: 0 });
    expect(change.testFiles).toEqual([
      { file: GONE.file, entered: [], left: [expect.objectContaining({ name: 'refund', startLine: 8 })] },
    ]);
  });
});

/** A copy of the fixture's checkout at a path of its own, its history included. */
async function copyOf(name: string): Promise<string> {
  const at = join(await mkdtemp(join(tmpdir(), `variance-coverage-base-${name}-`)), 'repo');
  await cp(repo, at, { recursive: true });
  copies.push(dirname(at));
  return at;
}

const copies: string[] = [];
afterAll(async () => {
  for (const copy of copies) await rm(copy, { recursive: true, force: true });
});
