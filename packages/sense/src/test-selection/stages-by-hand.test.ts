import { relationsOf } from '@variance-authority/core/relate';
import { describe, expect, it, vi } from 'vitest';
import { digestString } from '../digest.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { testsGovernedBy } from './lookup.js';
import {
  changeOfDiff,
  changeOfFiles,
  changeOfPaths,
  dependsReachFromView,
  ignoredChange,
  importersFromView,
  narrowByChangeFromView,
  readRowlessFromView,
  testsDeclaringFromView,
  testsEnteringFromView,
  type Change,
  type ExecutionNarrowingOptions,
  type TestCoverage,
} from './index.js';

// Passed through, and counted: each call is one scan of the precondition table.
vi.mock('./lookup.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lookup.js')>();
  return { ...actual, testsGovernedBy: vi.fn(actual.testsGovernedBy) };
});
const scans = vi.mocked(testsGovernedBy);

type Asked = Pick<ExecutionNarrowingOptions, 'sourceAt' | 'relations' | 'unmeasured' | 'ignore'>;

/**
 * The recipe the sense README gives for asking the stages by hand, run as it
 * is written: the suite's `ignore` cuts the change first; the coverage stage
 * and the reading take what is kept, the preconditions the whole change, the
 * importer walk what the reading left, and the depends walk what is ignored.
 */
function byHand(view: () => ReturnType<typeof openTestCoverage>, change: Change, { ignore, ...options }: Asked): readonly string[] {
  const { kept, ignored } = ignoredChange(change, ignore);
  const entered = [
    ...testsEnteringFromView(view(), kept, options).entered,
    ...testsDeclaringFromView(view(), change, options).entered,
  ];
  const { relations } = options;
  if (relations !== undefined) {
    const read = readRowlessFromView(view(), kept, options);
    entered.push(
      ...read.entered,
      ...importersFromView(view(), changeOfPaths(kept, read.unanswered), { ...options, relations }).entered,
      ...dependsReachFromView(view(), ignored, { ...options, relations }).entered,
    );
  }
  return [...new Set(entered)].sort();
}

/** The composition and the stages asked by hand select the same tests, across a suite's `ignore`, `/// <depends>` and declined relations. */
describe('the stages asked by hand', () => {
  const SOURCE = 'src/two.ts';
  const HELPER = 'src/helper.ts';
  const PAINT = 'src/paint.ts';
  const THEME = 'src/theme.css';
  const GENERATED = 'src/generated.ts';
  const LONE = 'src/lone.ts';
  const ENTERING = 'test/one.test.ts';
  const DECLARING = 'test/two.test.ts';
  const IMPORTING = 'test/three.test.ts';
  const PAINTING = 'test/paint.test.ts';
  const GENERATING = 'test/generated.test.ts';
  const COMMITTED_SOURCE = 'export function two(value) {\n  return value * 2;\n}\n';
  const COMMITTED_HELPER = 'module.exports = 1;\n';
  const module = (file: string, test: string, text: string, ordinal = 0): TestCoverage['modules'][number] => ({
    file,
    sourceDigest: digestString(text),
    instrumented: true,
    blocks: [
      { ordinal, kind: 'module', digest: `block:${file}`, name: '', path: 'module', startLine: 1, endLine: 3, source: true, testFiles: [test] },
      { ordinal: ordinal + 1, kind: 'function', owner: ordinal, digest: `block:${file}:body`, name: 'two', path: 'two', startLine: 1, endLine: 3, source: true, testFiles: [test] },
    ],
  });
  const record: TestCoverage = {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    commit: 'recorded',
    tests: [
      { file: ENTERING, complete: true, preconditions: [] },
      // Declares the source, the helper and the theme, and ran none of the texts the change arrives at.
      {
        file: DECLARING,
        complete: true,
        preconditions: [
          { name: SOURCE, digest: digestString(COMMITTED_SOURCE) },
          { name: HELPER, digest: digestString(COMMITTED_HELPER) },
          { name: THEME, digest: digestString('.theme {}\n') },
        ],
      },
      { file: IMPORTING, complete: true, preconditions: [] },
      { file: PAINTING, complete: true, preconditions: [] },
      { file: GENERATING, complete: true, preconditions: [] },
    ],
    modules: [module(SOURCE, ENTERING, COMMITTED_SOURCE), module(PAINT, PAINTING, COMMITTED_SOURCE), module(GENERATED, GENERATING, COMMITTED_SOURCE)],
  };
  const file = (name: string) => ({ kind: 'file', name }) as const;
  const relations = relationsOf({
    relations: [
      { from: file(IMPORTING), to: file(HELPER), kind: 'imports' },
      { from: file(DECLARING), to: file(HELPER), kind: 'imports' },
      { from: file(PAINTING), to: file(PAINT), kind: 'imports' },
      { from: file(PAINT), to: file(THEME), kind: 'depends' },
      { from: file(IMPORTING), to: file(THEME), kind: 'asset' },
      { from: file(GENERATING), to: file(GENERATED), kind: 'imports' },
    ],
  });
  const sourceAt = (name: string): string | undefined => ({ [SOURCE]: COMMITTED_SOURCE, [HELPER]: COMMITTED_HELPER, [GENERATED]: COMMITTED_SOURCE })[name];
  const view = () => openTestCoverage(encodeTestCoverage(record));
  const body = `--- a/${SOURCE}
+++ b/${SOURCE}
@@ -2,1 +2,1 @@
-  return value * 2;
+  return value + value;
`;
  const helper = `--- a/${HELPER}
+++ b/${HELPER}
@@ -1,1 +1,1 @@
-module.exports = 1;
+module.exports = 2;
`;
  const generated = body.replaceAll(SOURCE, GENERATED);
  const both = (a: Change, b: Change): Change => ({ lines: new Map([...a.lines, ...b.lines]), hunks: new Map([...a.hunks, ...b.hunks]) });
  const changes: ReadonlyArray<readonly [string, Change]> = [
    ['a measured file a test also declares', changeOfDiff(body)],
    ['a rowless file a test declares and another imports', changeOfDiff(helper)],
    ['a measured file the suite ignores', changeOfDiff(generated)],
    ['a stylesheet a module depends on and a test imports', changeOfFiles([THEME])],
    ['a rowless file nothing declares or imports', changeOfFiles([LONE])],
    ['all of them at once', both(changeOfDiff(body + helper + generated), changeOfFiles([THEME, LONE]))],
    ['all of them as lines with no hunks', { lines: changeOfDiff(body + helper + generated).lines, hunks: new Map() }],
  ];
  const suites: ReadonlyArray<readonly [string, Asked]> = [
    ['with the graph', { sourceAt, relations }],
    ['with the graph and an ignore', { sourceAt, relations, ignore: [GENERATED, '**/*.css'] }],
    ['declining relations, with an ignore', { sourceAt, relations, unmeasured: 'nothing', ignore: [GENERATED, '**/*.css'] }],
    ['with no graph', { sourceAt }],
  ];

  describe.each(suites)('%s', (_, options) => {
    it.each(changes)('selects what the composition selects for %s', (_, change) => {
      expect(byHand(view, change, options)).toEqual(narrowByChangeFromView(view(), change, options).entered);
    });
  });

  it('selects no test where the composition selects none', () => {
    const options: Asked = { sourceAt, relations, ignore: [GENERATED] };

    expect(narrowByChangeFromView(view(), changeOfDiff(generated), options).entered).toEqual([]);
    expect(byHand(view, changeOfDiff(generated), options)).toEqual([]);
    expect(byHand(view, changeOfFiles([LONE]), { sourceAt, relations })).toEqual([]);
  });

  it('follows the depends on an ignored stylesheet, and not its asset edge, as the composition does', () => {
    const options: Asked = { sourceAt, relations, ignore: ['**/*.css'] };

    expect(narrowByChangeFromView(view(), changeOfFiles([THEME]), options).entered).toEqual([PAINTING, DECLARING].sort());
    expect(byHand(view, changeOfFiles([THEME]), options)).toEqual([PAINTING, DECLARING].sort());
  });

  it('reads the precondition table once composed, and once for each stage that reads it by hand', () => {
    const change = both(changeOfDiff(body + helper + generated), changeOfFiles([THEME, LONE]));
    const options: Asked = { sourceAt, relations, ignore: [GENERATED, '**/*.css'] };

    scans.mockClear();
    narrowByChangeFromView(view(), change, options);
    expect(scans).toHaveBeenCalledTimes(1);

    scans.mockClear();
    byHand(view, change, options);
    // The preconditions, the importer walk and the depends walk each read it.
    expect(scans).toHaveBeenCalledTimes(3);
  });
});
