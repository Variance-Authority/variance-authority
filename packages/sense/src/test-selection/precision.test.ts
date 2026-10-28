import { relationsOfFiles, type EdgeUse, type FileRecord } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import type { TestCoverage } from './index.js';
import { narrowByExecutionFromView } from './select.js';
import type { Precision } from './precision.js';

/**
 * One diff read at each precision a suite may declare.
 *
 * `src/decide.ts` declares `decide` on lines 2 to 7 and a branch inside it on
 * lines 3 to 5. `alpha` took the branch, `beta` called `decide` without taking
 * it, and `gamma` only loaded the module. `test/omega.test.ts` imports the file
 * and ran nothing of it: the graph names it, the record does not.
 * `test/sigma.test.ts` loaded the module through a runner's setup file, which
 * no import names: the record holds it, the graph does not.
 */
const tests = ['test/alpha.test.ts', 'test/beta.test.ts', 'test/gamma.test.ts', 'test/omega.test.ts', 'test/sigma.test.ts'];
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
          testFiles: ['test/alpha.test.ts', 'test/beta.test.ts', 'test/gamma.test.ts', 'test/sigma.test.ts'],
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
  { file: 'test/sigma.test.ts' },
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

/** The text of `src/decide.ts` at the record's commit. */
const RECORDED = `export const other = 1;
export function decide(flag: boolean): string {
  if (flag) {
    return 'A';
  }
  return 'B';
}
`;

/** A one-line edit to the value of `other`. */
const atOther = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -1,1 +1,1 @@
-export const other = 1;
+export const other = 2;`;

const entered = (precision: Precision | undefined, extra: object = {}) =>
  narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), inBranch, {
    relations,
    ...(precision === undefined ? {} : { precision }),
    ...extra,
  }).entered;

describe('the precision a suite declares, from coarsest to finest', () => {
  it('reads regions when the suite declares nothing', () => {
    expect(entered(undefined)).toEqual(['test/alpha.test.ts']);
    expect(entered('region-use')).toEqual(['test/alpha.test.ts']);
  });

  it('widens a region to the declaration that holds it at function use', () => {
    expect(entered('function-use')).toEqual(['test/alpha.test.ts', 'test/beta.test.ts']);
  });

  it('selects every test that loaded the file at file use', () => {
    expect(entered('file-use')).toEqual(['test/alpha.test.ts', 'test/beta.test.ts', 'test/gamma.test.ts', 'test/sigma.test.ts']);
  });

  it('adds the importers of the exports that moved to file use at symbol', () => {
    const symbol = narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), inBranch, {
      relations,
      precision: 'symbol',
      moved: new Map([['src/decide.ts', ['other']]]),
    });
    expect(symbol.entered).toEqual(['test/alpha.test.ts', 'test/beta.test.ts', 'test/gamma.test.ts', 'test/omega.test.ts', 'test/sigma.test.ts']);
    expect(entered('symbol', { moved: new Map([['src/decide.ts', ['decide']]]) })).toEqual(entered('file-use'));
  });

  it('reads the exports that moved at symbol from the diff, applied to the text it was written against', () => {
    // The text the record holds, which the tree no longer is: the diff alone is the new side.
    const sourceAt = (file: string) => (file === 'src/decide.ts' ? RECORDED : undefined);
    expect(entered('symbol', { sourceAt })).toEqual(entered('file-use'));
    const onOther = narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), atOther, {
      relations,
      precision: 'symbol',
      sourceAt,
    });
    expect(onOther.entered).toContain('test/omega.test.ts');
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
      precision: 'file',
    });
    expect(narrowing.because.find((cause) => cause.test === 'test/omega.test.ts')).toEqual({
      test: 'test/omega.test.ts',
      via: [{ kind: 'importer', trail: ['src/decide.ts', 'test/omega.test.ts'] }],
    });
  });

  it('runs at every step what each finer step runs', () => {
    const moved = { moved: new Map([['src/decide.ts', ['decide']]]) };
    const steps = [entered('region-use'), entered('function-use'), entered('file-use'), entered('symbol', moved), entered('file', moved)];
    for (let finer = 0; finer + 1 < steps.length; finer += 1) {
      expect(steps[finer + 1]).toEqual(expect.arrayContaining(steps[finer]!));
    }
  });

  it('leaves out a test that imports the file for its types alone at file', () => {
    // Nothing behind `import type` runs, so `omega` loads no line of `src/decide.ts`.
    const typesOnly = relationsOfFiles(
      RECORDS.map((record) =>
        record.file === 'test/omega.test.ts' ? { file: record.file, edges: [{ to: 'src/decide.ts', kind: 'type' as const }] } : record,
      ),
    );
    const narrowing = narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), inBranch, {
      relations: typesOnly,
      precision: 'file',
    });
    expect(narrowing.entered).toEqual(tests.filter((file) => file !== 'test/omega.test.ts'));
  });

  it('keeps a test the record holds and the graph does not at file', () => {
    expect(entered('file')).toContain('test/sigma.test.ts');
  });

  it('reads a file the graph holds and the record does not, and walks a file it cannot read whole at symbol', () => {
    // `src/label.ts` has no row in the record and its recorded text is out of reach;
    // `notes.md` is not a module, so no export reading is taken for it.
    const elsewhere = `--- a/src/label.ts
+++ b/src/label.ts
@@ -1,1 +1,1 @@
-export const label = 'a';
+export const label = 'b';
--- a/notes.md
+++ b/notes.md
@@ -1,1 +1,1 @@
-old
+new`;
    const narrowing = narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), elsewhere, {
      relations,
      precision: 'symbol',
      sourceAt: () => undefined,
    });
    expect(narrowing.entered).toEqual(['test/omega.test.ts']);
    expect(narrowing.unread).toEqual(['notes.md']);
  });
});

/**
 * Two classes in one module, each with its own `render` on lines 2 to 4 and
 * 7 to 9. `alpha` rendered the first, `beta` the second. `src/about.ts`, a
 * module ahead of it, declares a third `render` that `beta` ran.
 */
const twins: TestCoverage = {
  version: 3,
  instrumentation: 'fixture-instrumentation',
  tests: ['test/alpha.test.ts', 'test/beta.test.ts'].map((file) => ({ file, complete: true, preconditions: [] })),
  modules: [
    {
      file: 'src/about.ts',
      sourceDigest: 'source:about',
      instrumented: true,
      blocks: [
        { ordinal: 0, kind: 'module', digest: 'block:module', name: '', path: 'module', startLine: 1, endLine: 4, source: true, testFiles: ['test/beta.test.ts'] },
        { ordinal: 1, kind: 'function', owner: 0, digest: 'block:about', name: 'render', path: 'render', startLine: 2, endLine: 3, source: true, testFiles: ['test/beta.test.ts'] },
      ],
    },
    {
      file: 'src/views.ts',
      sourceDigest: 'source:views',
      instrumented: true,
      blocks: [
        { ordinal: 0, kind: 'module', digest: 'block:module', name: '', path: 'module', startLine: 1, endLine: 10, source: true, testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'] },
        { ordinal: 1, kind: 'function', owner: 0, digest: 'block:first', name: 'render', path: 'First/render', startLine: 2, endLine: 4, source: true, testFiles: ['test/alpha.test.ts'] },
        { ordinal: 2, kind: 'branch', owner: 1, digest: 'block:first:then', name: 'render', path: 'First/render/if#0/then', startLine: 3, endLine: 3, source: true, testFiles: [] },
        { ordinal: 3, kind: 'function', owner: 0, digest: 'block:second', name: 'render', path: 'Second/render', startLine: 7, endLine: 9, source: true, testFiles: ['test/beta.test.ts'] },
      ],
    },
  ],
};

describe('the declaration a changed line is in, at function use', () => {
  it('is the function that owns the line, not every function that shares its name', () => {
    const inFirst = `--- a/src/views.ts
+++ b/src/views.ts
@@ -3,1 +3,1 @@
-      return 'a';
+      return 'b';`;
    expect(narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(twins)), inFirst, { precision: 'function-use' }).entered).toEqual([
      'test/alpha.test.ts',
    ]);
  });
});
