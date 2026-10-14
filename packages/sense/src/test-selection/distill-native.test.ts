import { describe, expect, it } from 'vitest';
import { withCaseSections } from './case-record.js';
import { encodeExecutionIndex } from './execution-format.js';
import { encodeAsSetExecutionIndex } from './execution-set-format.js';
import { encodeTestCoverage, type TestCoverage } from './format.js';
import { readDistillRecords } from './distill-native.js';
import type { ExecutionIndex } from './reverse.js';

const FILE = 'test/a.test.ts';

const COVERAGE: TestCoverage = {
  version: 3,
  instrumentation: 'fixture-instrumentation',
  tests: [{ file: FILE, complete: true, preconditions: [] }],
  modules: ['src/used.ts', 'src/unused.ts'].map((file) => ({
    file, sourceDigest: file, instrumented: true,
    blocks: [
      { ordinal: 0, kind: 'module', digest: `${file}#root`, name: '', path: '', source: true, testFiles: [FILE], loadedBy: [FILE], startLine: 1, endLine: 10 },
      { ordinal: 1, kind: 'function', owner: 0, digest: `${file}#run`, name: 'run', path: 'run', source: true, testFiles: [FILE], startLine: 2, endLine: 2 },
    ],
  })),
};

const index = (distance: number, stopped = false): ExecutionIndex => ({
  tests: [{ id: `${FILE} > one`, file: FILE, name: 'one', stopped: false }, { id: `${FILE} > two`, file: FILE, name: 'two', stopped: false }, { id: `${FILE} > three`, file: FILE, name: 'three', stopped }],
  modules: [
    { file: 'src/used.ts', blocks: [{ kind: 'function', name: 'run', path: 'run', startLine: 2, endLine: 2, source: true, crossings: [{ test: 0, distance }, { test: 1, distance: 0 }] }] },
    { file: 'src/unused.ts', blocks: [{ kind: 'function', name: 'run', path: 'run', startLine: 2, endLine: 2, source: true, crossings: [{ test: 2, distance, loaded: true }] }] },
  ],
});

describe('readDistillRecords', () => {
  it('reads which modules no case of the file entered, and how many cases it holds', () => {
    const near = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeAsSetExecutionIndex(index(0)) })]).file(FILE);

    expect(near.names[near.module[0]!]).toBe('src/unused.ts');
    expect([near.cases, near.unsettled]).toEqual([3, 0]);
  });

  it('counts a case the index holds as stopped as unsettled', () => {
    const sets = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeAsSetExecutionIndex(index(0, true)) })]).file(FILE);

    expect([sets.cases, sets.unsettled]).toEqual([3, 1]);
  });

  it('refuses a case index in the row spelling, which no writer emits any more', () => {
    expect(() => readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeExecutionIndex(index(0)) })]))
      .toThrow('record the suite again');
  });

  it('reads an importer\'s regions against the file\'s cases', () => {
    const sets = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeAsSetExecutionIndex(index(0)) })]);
    const region = { kind: 'function', name: 'run', path: 'run', startLine: 2, endLine: 2, source: true };

    expect(sets.regions(FILE, 'src/used.ts')).toEqual([{ ...region, ran: true, called: expect.any(Uint32Array) }]);
    expect(sets.regions(FILE, 'src/used.ts')[0]!.called).toHaveLength(1);
    expect(sets.regions(FILE, 'src/unused.ts')).toEqual([{ ...region, ran: false, called: new Uint32Array() }]);
    expect(sets.regions(FILE, 'src/absent.ts')).toEqual([]);
    expect(sets.cases(FILE).map(({ name }) => name)).toEqual(['one', 'two', 'three']);
    expect(sets.cases('test/absent.test.ts')).toEqual([]);
  });
});
