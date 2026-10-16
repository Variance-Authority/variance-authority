import { relationsOfFiles, type EdgeUse, type FileRecord } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import type { TestCoverage } from './index.js';
import { narrowByExecutionFromView } from './select.js';
import type { Evidence } from './evidence.js';

/**
 * One diff read at each step of evidence a suite may trust.
 *
 * `src/decide.ts` declares `decide` on lines 2 to 7 and a branch inside it on
 * lines 3 to 5. `alpha` took the branch, `beta` called `decide` without taking
 * it, and `gamma` only loaded the module. `test/omega.test.ts` imports the file
 * and ran nothing of it: the graph names it, the record does not.
 */
const tests = ['test/alpha.test.ts', 'test/beta.test.ts', 'test/gamma.test.ts', 'test/omega.test.ts'];
const coverage: TestCoverage = {
  version: 3,
  instrumentation: 'fixture-instrumentation',
  tests: tests.map((file) => ({ file, complete: true, preconditions: [{ name: file, digest: `source:${file}` }] })),
  modules: [
    {
      file: 'src/decide.ts',
      sourceDigest: 'source:decide',
      instrumented: true,
      blocks: [
        {
          ordinal: 0,
          kind: 'module',
          digest: 'block:module',
          name: '',
          path: 'module',
          startLine: 1,
          endLine: 9,
          source: true,
          testFiles: ['test/alpha.test.ts', 'test/beta.test.ts', 'test/gamma.test.ts'],
        },
        {
          ordinal: 1,
          kind: 'function',
          owner: 0,
          digest: 'block:decide',
          name: 'decide',
          path: 'function',
          startLine: 2,
          endLine: 7,
          source: true,
          testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'],
        },
        {
          ordinal: 2,
          kind: 'branch',
          owner: 1,
          digest: 'block:decide:then',
          name: 'decide',
          path: 'if#0/then',
          startLine: 3,
          endLine: 5,
          source: true,
          testFiles: ['test/alpha.test.ts'],
        },
      ],
    },
  ],
};

const RECORDS: readonly FileRecord[] = [
  { file: 'src/decide.ts' },
  { file: 'src/label.ts' },
  ...tests.slice(0, 3).map((file) => ({ file, edges: [{ to: 'src/decide.ts', kind: 'imports' as const }] })),
  { file: 'test/omega.test.ts', edges: [{ to: 'src/label.ts', kind: 'imports' as const }, { to: 'src/decide.ts', kind: 'imports' as const }] },
];
const USES: Readonly<Record<string, EdgeUse>> = {
  'test/alpha.test.ts>src/decide.ts': { imports: ['decide'] },
  'test/beta.test.ts>src/decide.ts': { imports: ['decide'] },
  'test/gamma.test.ts>src/decide.ts': { imports: ['other'] },
  'test/omega.test.ts>src/decide.ts': { imports: ['other'] },
};
const relations = relationsOfFiles(RECORDS, { uses: (importer, target) => USES[`${importer}>${target}`] });

/** A one-line edit inside the branch. */
const inBranch = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,1 @@
-    return 'A';
+    return 'Alpha';`;

const entered = (evidence: Evidence | undefined, extra: object = {}) =>
  narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), inBranch, {
    relations,
    ...(evidence === undefined ? {} : { evidence }),
    ...extra,
  }).entered;

describe('the evidence a suite trusts, from coarsest to finest', () => {
  it('reads regions when the suite declares nothing', () => {
    expect(entered(undefined)).toEqual(['test/alpha.test.ts']);
    expect(entered('region-use')).toEqual(['test/alpha.test.ts']);
  });

  it('widens a region to the declaration that holds it at function use', () => {
    expect(entered('function-use')).toEqual(['test/alpha.test.ts', 'test/beta.test.ts']);
  });

  it('selects every test that loaded the file at file use', () => {
    expect(entered('file-use')).toEqual(['test/alpha.test.ts', 'test/beta.test.ts', 'test/gamma.test.ts']);
  });

  it('selects every recorded test that imports the file at symbol, narrowed by the exports that moved', () => {
    expect(entered('symbol', { moved: new Map([['src/decide.ts', ['decide']]]) })).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });

  it('walks the file whole at symbol when no export reading was taken', () => {
    expect(entered('symbol')).toEqual(tests);
  });

  it('selects every recorded test that imports the file at file, whatever moved', () => {
    expect(entered('file', { moved: new Map([['src/decide.ts', ['decide']]]) })).toEqual(tests);
  });

  it('says why a relation step selected a test: the chain from the changed file', () => {
    const narrowing = narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), inBranch, {
      relations,
      evidence: 'file',
    });
    expect(narrowing.because.find((cause) => cause.test === 'test/omega.test.ts')).toEqual({
      test: 'test/omega.test.ts',
      via: [{ kind: 'importer', trail: ['src/decide.ts', 'test/omega.test.ts'] }],
    });
  });

  it('selects a loader at file use that symbol skips, because the two trust different evidence', () => {
    // gamma imports `other` and ran the module's top level, never `decide`.
    expect(entered('symbol', { moved: new Map([['src/decide.ts', ['decide']]]) })).not.toContain('test/gamma.test.ts');
    expect(entered('file-use')).toContain('test/gamma.test.ts');
  });
});
