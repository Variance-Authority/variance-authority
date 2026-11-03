import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileCases, recordedDurations, recordedPaths, recordedTimes } from './recorded-durations.js';
import { withCaseSections } from './test-selection/case-record.js';
import { encodeExecutionIndex } from './test-selection/execution-format.js';
import { encodeTestCoverage } from './test-selection/format.js';
import { testCoverageFile } from './test-selection/record-location.js';
import type { CoverageModule, ExecutionIndex, FilePhases, TestCoverage } from './test-selection/index.js';

/**
 * The reading `variance ask slowest-tests` is made of: the durations a
 * recording holds, for files and for cases, anywhere or inside a scope, over a
 * checkout that published one and over one that did not, which is answered
 * with where it looked.
 */

function module(file: string, testFiles: readonly string[]): CoverageModule {
  return {
    file,
    sourceDigest: `digest:${file}`,
    instrumented: true,
    blocks: [{
      ordinal: 0, kind: 'module', digest: `block:${file}`, name: '', path: 'entry', source: true,
      startLine: 1, endLine: 5, testFiles,
    }],
  };
}

function coverage(
  tests: readonly (readonly [string, number | undefined, FilePhases?])[],
  modules: readonly CoverageModule[] = [],
): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: tests.map(([file, duration, phases]) => ({
      file,
      complete: true,
      preconditions: [],
      ...(duration === undefined ? {} : { duration }),
      ...(phases === undefined ? {} : { phases }),
    })),
    modules,
  };
}

let root: string;

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-durations-cache-')));
  root = mkdtempSync(join(tmpdir(), 'va-durations-'));
  execFileSync('git', ['init', '--quiet', root]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function record(snapshot: TestCoverage, cases?: ExecutionIndex): string {
  const at = testCoverageFile(root);
  mkdirSync(dirname(at), { recursive: true });
  const bytes = encodeTestCoverage(snapshot);
  writeFileSync(at, cases === undefined ? bytes : withCaseSections(bytes, { index: encodeExecutionIndex(cases) }));
  return at;
}

const NO_CASES = { unread: 'no run kept its cases there' };

/**
 * Three ways a runner times a file. Vitest's duration is its cases alone, and
 * the phases before them are where an import-heavy file spends its time; Jest's
 * is the whole file, which its phases add up to less than; and a runner that
 * reports phases but no duration still timed the file.
 */
const TIMED_THREE_WAYS: readonly (readonly [string, number | undefined, FilePhases?])[] = [
  ['test/vitest.test.ts', 33, { prepare: 125, environment: 979, setup: 15, collect: 4258, cases: 33 }],
  ['test/jest.test.ts', 1000, { environment: 100, setup: 10, collect: 300, cases: 400 }],
  ['test/phased.test.ts', undefined, { collect: 700, cases: 20 }],
  ['test/plain.test.ts', 900],
];

describe('the slowest recorded test files', () => {
  it('lists the slowest first, breaks ties by path, and counts the untimed apart', () => {
    const at = record(coverage([
      ['test/a.test.ts', 40],
      ['test/b.test.ts', 900],
      ['test/c.test.ts', undefined],
      ['test/d.test.ts', 40],
      ['test/e.test.ts', 0],
    ]));

    expect(recordedDurations(root, 3)).toEqual([
      {
        recording: at,
        slowest: [
          { file: 'test/b.test.ts', duration: 900 },
          { file: 'test/a.test.ts', duration: 40 },
          { file: 'test/d.test.ts', duration: 40 },
        ],
        timed: 4,
        untimed: 1,
        scope: { unrecorded: [] },
        origin: 'own',
        cases: { recording: at, ...NO_CASES },
      },
    ]);
  });

  it('ranks a file by what running it cost, the phases before its first case included', () => {
    record(coverage(TIMED_THREE_WAYS));

    const [suite] = recordedDurations(root, 4);

    expect(suite !== undefined && 'slowest' in suite ? suite.slowest : suite).toEqual([
      { file: 'test/vitest.test.ts', duration: 5410 },
      { file: 'test/jest.test.ts', duration: 1000 },
      { file: 'test/plain.test.ts', duration: 900 },
      { file: 'test/phased.test.ts', duration: 720 },
    ]);
  });

  it('says where it looked when nothing is recorded', () => {
    expect(recordedDurations(root, 3)).toEqual([
      {
        recording: testCoverageFile(root),
        origin: 'own',
        unread: 'nothing is recorded there',
        cases: { recording: testCoverageFile(root), ...NO_CASES },
      },
    ]);
  });
});

/** Two test files: `a` enters `src/format.ts`, `b` enters `src/other/read.ts`. */
function twoModules(): string {
  return record(
    coverage(
      [['test/a.test.ts', 300], ['test/b.test.ts', 500], ['spec/c.test.ts', undefined]],
      [module('src/format.ts', ['test/a.test.ts']), module('src/other/read.ts', ['test/b.test.ts', 'spec/c.test.ts'])],
    ),
    {
      tests: [
        { id: 'a1', file: 'test/a.test.ts', name: 'writes', duration: 120 },
        { id: 'a2', file: 'test/a.test.ts', name: 'reads' },
        { id: 'b1', file: 'test/b.test.ts', name: 'reads > twice', duration: 480 },
        { id: 'b2', file: 'test/b.test.ts', name: 'reads > once', duration: 480 },
      ],
      modules: [
        { file: 'src/format.ts', blocks: [{ kind: 'module', name: '', path: 'entry', startLine: 1, endLine: 5, source: true, crossings: [{ test: 0, distance: 0 }, { test: 1, distance: 0 }] }] },
        { file: 'src/other/read.ts', blocks: [{ kind: 'module', name: '', path: 'entry', startLine: 1, endLine: 5, source: true, crossings: [{ test: 2, distance: 0 }, { test: 3, distance: 0 }] }] },
      ],
    },
  );
}

describe('the slowest recorded test cases', () => {
  it('ranks cases by the duration their runner reported, ties by file and then by name', () => {
    const at = twoModules();

    const [suite] = recordedDurations(root, 2);

    expect(suite?.cases).toEqual({
      recording: at,
      slowest: [
        { file: 'test/b.test.ts', name: 'reads > once', duration: 480 },
        { file: 'test/b.test.ts', name: 'reads > twice', duration: 480 },
      ],
      closest: [],
      limited: 0,
      faster: 0,
      timed: 3,
      untimed: 1,
      scope: { unrecorded: [] },
    });
  });
});

/** Cases a limit reads differently from a clock: the long one has room, the short one has none. */
function limitedCases(): string {
  return record(coverage([['test/a.test.ts', 300], ['slow/b.test.ts', 500]]), {
    tests: [
      { id: 'a', file: 'slow/b.test.ts', name: 'imports the world', duration: 40_000, limit: 60_000 },
      { id: 'b', file: 'test/a.test.ts', name: 'nearly out', duration: 4_900, limit: 5_000 },
      { id: 'c', file: 'test/a.test.ts', name: 'hooks ran long', duration: 5_300, limit: 5_000 },
      { id: 'd', file: 'test/a.test.ts', name: 'never said', duration: 7_000 },
      { id: 'e', file: 'test/a.test.ts', name: 'quick', duration: 10, limit: 5_000 },
      { id: 'f', file: 'test/a.test.ts', name: 'untimed', limit: 5_000 },
    ],
    modules: [],
  });
}

describe('the cases closest to their limit', () => {
  it('ranks by how much of its limit a case ran, so 4.9 s of 5 s stands above 40 s of 60 s', () => {
    limitedCases();

    const [suite] = recordedDurations(root, 3);

    expect(suite?.cases).toMatchObject({
      closest: [
        { name: 'hooks ran long', duration: 5_300, limit: 5_000 },
        { name: 'nearly out', duration: 4_900, limit: 5_000 },
        { name: 'imports the world', duration: 40_000, limit: 60_000 },
      ],
      limited: 4,
      timed: 5,
      untimed: 1,
    });
  });

  it('breaks a tie of the same share by the longer run, then by file and name', () => {
    record(coverage([['test/a.test.ts', 300]]), {
      tests: [
        { id: 'a', file: 'test/a.test.ts', name: 'half of little', duration: 100, limit: 200 },
        { id: 'b', file: 'test/a.test.ts', name: 'half of much', duration: 1_000, limit: 2_000 },
      ],
      modules: [],
    });

    const [suite] = recordedDurations(root, 2);

    expect(suite?.cases).toMatchObject({ closest: [{ name: 'half of much' }, { name: 'half of little' }] });
  });

  it('leaves a record before the column with nothing to rank, and every case still timed', () => {
    twoModules();

    const [suite] = recordedDurations(root, 2);

    expect(suite?.cases).toMatchObject({ closest: [], limited: 0, timed: 3 });
  });
});

describe('cases that ran at least a time', () => {
  it('keeps only those cases, in both rankings, counting what ran faster and leaving the untimed unknown', () => {
    limitedCases();

    const [suite] = recordedDurations(root, 10, {}, 5_000);

    expect(suite?.cases).toMatchObject({
      slowest: [{ name: 'imports the world' }, { name: 'never said' }, { name: 'hooks ran long' }],
      closest: [{ name: 'hooks ran long' }, { name: 'imports the world' }],
      limited: 2,
      timed: 3,
      faster: 2,
      untimed: 1,
    });
  });

  it('keeps a case that ran exactly that long', () => {
    limitedCases();

    const [suite] = recordedDurations(root, 10, {}, 5_300);

    expect(suite?.cases).toMatchObject({ timed: 3 });
  });

  it('narrows inside the scope, and counts inside it', () => {
    limitedCases();

    const [suite] = recordedDurations(root, 10, { from: ['slow'] }, 3_000);

    expect(suite?.cases).toMatchObject({ slowest: [{ name: 'imports the world' }], timed: 1, faster: 0, untimed: 0 });
  });
});

describe('the record an answer read', () => {
  function committed(): string {
    const git = (...args: readonly string[]): string =>
      execFileSync('git', ['-C', root, '-c', 'user.name=a', '-c', 'user.email=a@b', ...args], {
        encoding: 'utf8',
        env: { ...process.env, GIT_COMMITTER_DATE: '2026-10-01T12:00:00Z' },
      }).trim();
    git('commit', '--quiet', '--allow-empty', '-m', 'one');
    return git('rev-parse', 'HEAD');
  }

  it('names the commit it was taken at and when that commit was made', () => {
    const commit = committed();
    record({ ...coverage([['test/a.test.ts', 40]]), commit });

    const [suite] = recordedDurations(root, 1);

    expect(suite).toMatchObject({ origin: 'own', commit });
    expect(Date.parse((suite as { committed: string }).committed)).toBe(Date.parse('2026-10-01T12:00:00Z'));
  });

  it('keeps a commit this checkout does not hold, with no time to give it', () => {
    const commit = 'f'.repeat(40);
    record({ ...coverage([['test/a.test.ts', 40]]), commit });

    const [suite] = recordedDurations(root, 1);

    expect(suite).toMatchObject({ commit });
    expect(suite).not.toHaveProperty('committed');
  });
});

describe('slowest where', () => {
  it('keeps the tests declared under a `from` path, on a `/` boundary, and counts inside it', () => {
    twoModules();

    const [suite] = recordedDurations(root, 5, { from: ['test'] });

    expect(suite).toMatchObject({
      slowest: [{ file: 'test/b.test.ts' }, { file: 'test/a.test.ts' }],
      timed: 2,
      untimed: 0,
      scope: { declared: 2, unrecorded: [] },
    });
    expect(recordedDurations(root, 5, { from: ['tes'] })[0]).toMatchObject({ timed: 0, untimed: 0, scope: { declared: 0 } });
  });

  it('keeps the tests the recording says entered a `to` path, files and cases each from their own record', () => {
    twoModules();

    const [suite] = recordedDurations(root, 5, { to: ['src/other'] });

    expect(suite).toMatchObject({
      slowest: [{ file: 'test/b.test.ts', duration: 500 }],
      timed: 1,
      untimed: 1,
      scope: { entered: 2, unrecorded: [] },
      cases: { timed: 2, untimed: 0, scope: { entered: 2, unrecorded: [] } },
    });
    expect(suite?.cases).toMatchObject({ slowest: [{ name: 'reads > once' }, { name: 'reads > twice' }] });
  });

  it('combines the two, and names a `to` path the recording has no row for as unrecorded', () => {
    twoModules();

    const [suite] = recordedDurations(root, 5, { from: ['spec/'], to: ['src/other/read.ts', 'src/absent.ts'] });

    expect(suite).toMatchObject({
      slowest: [],
      timed: 0,
      untimed: 1,
      scope: { declared: 1, entered: 2, unrecorded: ['src/absent.ts'] },
      cases: { timed: 0, untimed: 0, scope: { declared: 0, entered: 2, unrecorded: ['src/absent.ts'] } },
    });
  });

  it('lists every recorded path for a reader to suggest one from', () => {
    twoModules();

    expect(recordedPaths(root)).toEqual([
      'spec/c.test.ts', 'src/format.ts', 'src/other/read.ts', 'test/a.test.ts', 'test/b.test.ts',
    ]);
  });
});

describe('the times a shard places its files by', () => {
  it('holds every timed file, the commit it was recorded at and the record it read, and leaves an untimed one out', () => {
    const at = record({ ...coverage([['test/a.test.ts', 40], ['test/b.test.ts', undefined], ['test/c.test.ts', 0]]), commit: 'c'.repeat(40) });

    const times = recordedTimes(at);

    const read = `sha256:${createHash('sha256').update(readFileSync(at)).digest('hex')}`;
    expect(times).toEqual({ recording: at, read, commit: 'c'.repeat(40), times: new Map([['test/a.test.ts', 40], ['test/c.test.ts', 0]]) });
  });

  it('places a file by what running it cost, the phases before its first case included', () => {
    const at = record(coverage(TIMED_THREE_WAYS));

    const times = recordedTimes(at);

    expect('times' in times ? times.times : times).toEqual(new Map([
      ['test/vitest.test.ts', 5410],
      ['test/jest.test.ts', 1000],
      ['test/phased.test.ts', 720],
      ['test/plain.test.ts', 900],
    ]));
  });

  it('throws when what is recorded there does not read, because a shard placed without it may disagree with one that read it', () => {
    const at = testCoverageFile(root);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, 'not a record');

    expect(() => recordedTimes(at)).toThrow();
  });

  it('says why when nothing is recorded there, rather than handing an empty map', () => {
    expect(recordedTimes(testCoverageFile(root))).toEqual({ recording: testCoverageFile(root), unread: 'nothing is recorded there' });
  });
});

describe('the slowest cases of one file', () => {
  it('ranks the cases one file declares, and none of another', () => {
    const at = twoModules();

    expect(fileCases(at, 'test/b.test.ts', 1)).toEqual([{ file: 'test/b.test.ts', name: 'reads > once', duration: 480 }]);
  });

  it('is absent when no run kept its cases, rather than a file with none', () => {
    const at = record(coverage([['test/a.test.ts', 40]]));

    expect(fileCases(at, 'test/a.test.ts', 3)).toBeUndefined();
  });
});
