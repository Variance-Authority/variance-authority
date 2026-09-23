import { describe, expect, it } from 'vitest';
import { relationsOfFiles, type FileRecord } from '@variance-authority/core/relate';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import type { CoverageBlock, TestCoverage } from './index.js';
import { selectTestFilesFromView } from './select.js';

/**
 * `api.ts` imports `http.ts`. `card.test.ts` mocks `api.ts` and reaches `http.ts`
 * only through it; `wire.test.ts` mocks `api.ts` too and imports `http.ts`
 * itself; `plain.test.ts` mocks nothing. Every test loads both modules, because
 * a runner evaluates the real `api.ts` — and so its imports — to shape the
 * automock, and only `plain.test.ts` calls `get` and `send`.
 */
const RECORDS: readonly FileRecord[] = [
  { file: 'src/http.ts' },
  { file: 'src/api.ts', edges: [{ to: 'src/http.ts', kind: 'imports' }] },
  { file: 'src/card.ts', edges: [{ to: 'src/api.ts', kind: 'imports' }] },
  { file: 'test/card.test.ts', edges: [{ to: 'src/card.ts', kind: 'imports' }, { to: 'src/api.ts', kind: 'imports' }] },
  { file: 'test/plain.test.ts', edges: [{ to: 'src/card.ts', kind: 'imports' }] },
  {
    file: 'test/wire.test.ts',
    edges: [{ to: 'src/card.ts', kind: 'imports' }, { to: 'src/api.ts', kind: 'imports' }, { to: 'src/http.ts', kind: 'imports' }],
  },
];
const shadows = new Map([
  ['test/card.test.ts', ['src/api.ts']],
  ['test/wire.test.ts', ['src/api.ts']],
]);
const relations = relationsOfFiles(RECORDS, { shadows });
const TESTS = ['test/card.test.ts', 'test/plain.test.ts', 'test/wire.test.ts'];

const scope = (loadedBy: readonly string[]): CoverageBlock => ({
  ordinal: 0, kind: 'module', digest: 'module', name: '', path: 'module', startLine: 1, endLine: 8, source: true,
  testFiles: TESTS, loadedBy,
});
const fn = (name: string, tests: readonly string[]): CoverageBlock => ({
  ordinal: 1, kind: 'function', owner: 0, digest: name, name, path: '', startLine: 3, endLine: 5, source: true,
  testFiles: tests,
});

const record = (getCalledBy: readonly string[], sendCalledBy: readonly string[]): TestCoverage => ({
  version: 3,
  instrumentation: 'fixture',
  tests: TESTS.map((file) => ({ file, complete: true, preconditions: [] })),
  modules: [
    { file: 'src/api.ts', sourceDigest: 'api', instrumented: true, blocks: [scope(TESTS), fn('get', getCalledBy)] },
    { file: 'src/http.ts', sourceDigest: 'http', instrumented: true, blocks: [scope(TESTS), fn('send', sendCalledBy)] },
  ],
});

const edit = (file: string, line: number): string => `--- a/${file}
+++ b/${file}
@@ -${line},1 +${line},1 @@
-const base = 'a';
+const base = 'b';`;

const select = (coverage: TestCoverage, diff: string, withGraph = true): readonly string[] =>
  selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff, withGraph ? { relations } : {});

describe('a module a test mocked', () => {
  it('does not select a test that only loaded the module it mocked', () => {
    const coverage = record(['test/plain.test.ts'], ['test/plain.test.ts']);

    expect(select(coverage, edit('src/api.ts', 1))).toEqual(['test/plain.test.ts']);
  });

  it('selects every loader when the graph carries no shadows, which is the record as written', () => {
    const coverage = record(['test/plain.test.ts'], ['test/plain.test.ts']);

    expect(select(coverage, edit('src/api.ts', 1), false)).toEqual(TESTS);
  });

  it('does not select a test that called into the module it mocked, because the mock is what it ran against', () => {
    // The real `get` ran for `card.test.ts`, so its mock did not take; the
    // audit names that, and selection still does not follow it.
    const coverage = record(['test/card.test.ts', 'test/plain.test.ts'], ['test/plain.test.ts']);

    expect(select(coverage, edit('src/api.ts', 4))).toEqual(['test/plain.test.ts']);
  });

  it('does not select a test that reaches a dependency only through its mock', () => {
    // `wire.test.ts` imports `http.ts` itself, so its load there is its own.
    const coverage = record(['test/plain.test.ts'], ['test/plain.test.ts']);

    expect(select(coverage, edit('src/http.ts', 1))).toEqual(['test/plain.test.ts', 'test/wire.test.ts']);
  });

  it('does not select a test that called into a dependency of its mock', () => {
    const coverage = record(['test/plain.test.ts'], ['test/card.test.ts', 'test/plain.test.ts']);

    // `wire.test.ts` loaded `http.ts` by its own import and never called `send`.
    expect(select(coverage, edit('src/http.ts', 4))).toEqual(['test/plain.test.ts']);
  });
});
