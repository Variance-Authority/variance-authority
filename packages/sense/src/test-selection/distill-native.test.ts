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
  it('reads a case index in the row spelling as the set spelling of the same crossings, at any depth', () => {
    const rows = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeExecutionIndex(index(2)) })]).file(FILE);
    const sets = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeAsSetExecutionIndex(index(0)) })]).file(FILE);

    expect(rows).toEqual(sets);
    expect(rows.names[rows.module[0]!]).toBe('src/unused.ts');
    expect([rows.cases, rows.unsettled]).toEqual([3, 0]);
  });

  it('counts a case the row spelling holds as stopped as unsettled', () => {
    const rows = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeExecutionIndex(index(2, true)) })]).file(FILE);
    const sets = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeAsSetExecutionIndex(index(0, true)) })]).file(FILE);

    expect(rows).toEqual(sets);
    expect([rows.cases, rows.unsettled]).toEqual([3, 1]);
  });

  it('reads an importer\'s regions against the file\'s cases in either spelling, the load of a case only in the rows', () => {
    const rows = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeExecutionIndex(index(2)) })]);
    const sets = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeAsSetExecutionIndex(index(0)) })]);
    const region = { kind: 'function', name: 'run', path: 'run', startLine: 2, endLine: 2, source: true };

    expect(rows.regions(FILE, 'src/used.ts')).toEqual(sets.regions(FILE, 'src/used.ts'));
    expect(rows.regions(FILE, 'src/used.ts')).toEqual([{ ...region, ran: true, atLoad: false, called: expect.any(Uint32Array) }]);
    expect(rows.regions(FILE, 'src/used.ts')[0]!.called).toHaveLength(1);
    expect(rows.regions(FILE, 'src/unused.ts')).toEqual([{ ...region, ran: false, atLoad: true, called: new Uint32Array() }]);
    expect(sets.regions(FILE, 'src/unused.ts')).toEqual([{ ...region, ran: false, atLoad: false, called: new Uint32Array() }]);
    expect(rows.regions(FILE, 'src/absent.ts')).toEqual([]);
    expect(rows.cases(FILE).map(({ name }) => name)).toEqual(['one', 'two', 'three']);
  });
});
