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

const index = (distance: number): ExecutionIndex => ({
  tests: [{ id: `${FILE} > one`, file: FILE, name: 'one', stopped: false }, { id: `${FILE} > two`, file: FILE, name: 'two', stopped: false }],
  modules: [{
    file: 'src/used.ts',
    blocks: [{ kind: 'function', name: 'run', path: 'run', startLine: 2, endLine: 2, source: true, crossings: [{ test: 0, distance }, { test: 1, distance: 0 }] }],
  }],
});

describe('readDistillRecords', () => {
  it('reads a case index in the row spelling as the set spelling of the same crossings, at any depth', () => {
    const rows = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeExecutionIndex(index(2)) })]).file(FILE);
    const sets = readDistillRecords([withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeAsSetExecutionIndex(index(0)) })]).file(FILE);

    expect(rows).toEqual(sets);
    expect(rows.names[rows.module[0]!]).toBe('src/unused.ts');
  });
});
