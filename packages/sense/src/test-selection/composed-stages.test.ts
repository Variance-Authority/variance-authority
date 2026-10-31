import { relationsOf } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import {
  changeOfDiff,
  importersFromView,
  narrowByChangeFromView,
  testsDeclaringFromView,
  testsEnteringFromView,
  type TestCoverage,
} from './index.js';

/**
 * A stage asked alone gives the answer the composition gives for its part,
 * with the texts at the recorded commit in hand: the frame check on a measured
 * file, and the digest a declaring test already ran over.
 */
describe('the composition is its stages', () => {
  const SOURCE = 'src/two.ts';
  const DECLARING = 'test/two.test.ts';
  const ENTERING = 'test/one.test.ts';
  const COMMITTED_SOURCE = 'export function two(value) {\n  return value * 2;\n}\n\nexport const name = "two";\n';
  const COMMITTED_TEST = "it('doubles', () => {\n  expect(1).toBe(1);\n});\n";
  const EDITED_TEST = "it('doubles', () => {\n  expect(0).toBe(0);\n  expect(1).toBe(1);\n});\n";
  const record: TestCoverage = {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    commit: 'recorded',
    tests: [
      { file: ENTERING, complete: true, preconditions: [] },
      // The declaring test ran over the text the change arrives at.
      { file: DECLARING, complete: true, preconditions: [{ name: DECLARING, digest: digestString(EDITED_TEST) }] },
    ],
    modules: [
      {
        file: SOURCE,
        // Cut from another text than the commit's: the record's line numbers say nothing here.
        sourceDigest: digestString('a text the commit never held'),
        instrumented: true,
        blocks: [
          { ordinal: 0, kind: 'module', digest: 'block:two', name: '', path: 'module', startLine: 1, endLine: 3, source: true, testFiles: [ENTERING] },
        ],
      },
    ],
  };
  const change = changeOfDiff(`--- a/${SOURCE}
+++ b/${SOURCE}
@@ -5,1 +5,1 @@
-export const name = "two";
+export const name = "three";
--- a/${DECLARING}
+++ b/${DECLARING}
@@ -1,3 +1,4 @@
 it('doubles', () => {
+  expect(0).toBe(0);
   expect(1).toBe(1);
 });
`);
  const sourceAt = (file: string): string | undefined => ({ [SOURCE]: COMMITTED_SOURCE, [DECLARING]: COMMITTED_TEST })[file];
  const view = () => openTestCoverage(encodeTestCoverage(record));

  it('charges a measured file whose record was cut from another text whole, as the composition does', () => {
    const alone = testsEnteringFromView(view(), change, { sourceAt });

    expect(alone.entered).toEqual([ENTERING]);
    expect(alone.stale).toEqual([SOURCE]);
    expect(narrowByChangeFromView(view(), change, { sourceAt })).toMatchObject({ entered: [ENTERING], stale: [SOURCE] });
  });

  it('keeps no declaring test that already ran the text the change arrives at, as the composition does', () => {
    expect(testsDeclaringFromView(view(), change, { sourceAt }).entered).toEqual([]);
    expect(narrowByChangeFromView(view(), change, { sourceAt }).entered).not.toContain(DECLARING);
  });

  it('keeps a test whose own file the change edits when it declared no precondition and was never seen whole', () => {
    const unseen = { ...record, tests: [record.tests[0]!, { file: DECLARING, complete: false, preconditions: [] }] };
    const opened = openTestCoverage(encodeTestCoverage(unseen));

    expect(testsDeclaringFromView(opened, change, { sourceAt })).toMatchObject({ entered: [DECLARING], unanswered: [SOURCE] });
    const composed = narrowByChangeFromView(opened, change, { sourceAt });
    expect(composed.because).toContainEqual({ test: DECLARING, via: [{ kind: 'precondition', name: DECLARING }] });
    expect(composed.unread).not.toContain(DECLARING);
  });

  it('names a stale file once, as stale', () => {
    const { stale, readings } = narrowByChangeFromView(view(), change, { sourceAt });

    expect(stale).toEqual([SOURCE]);
    expect(readings?.filter((reading) => reading.file === SOURCE)).toEqual([{ file: SOURCE, unread: 'stale' }]);
  });

  it('walks a rowless file a declaring test already ran the arrived text of, as the composition does', () => {
    const HELPER = 'src/helper.ts';
    const COMMITTED_HELPER = 'export const one = 1;\n';
    const EDITED_HELPER = 'export const one = 1;\nexport const two = 2;\n';
    const walked: TestCoverage = {
      ...record,
      // The test declared the helper and ran it as the change leaves it.
      tests: [{ file: DECLARING, complete: true, preconditions: [{ name: HELPER, digest: digestString(EDITED_HELPER) }] }],
      modules: [],
    };
    const edit = changeOfDiff(`--- a/${HELPER}
+++ b/${HELPER}
@@ -1,1 +1,2 @@
 export const one = 1;
+export const two = 2;
`);
    const relations = relationsOf({ relations: [{ from: { kind: 'file', name: DECLARING }, to: { kind: 'file', name: HELPER }, kind: 'imports' }] });
    const helperAt = (file: string): string | undefined => (file === HELPER ? COMMITTED_HELPER : undefined);
    const opened = () => openTestCoverage(encodeTestCoverage(walked));

    const composed = narrowByChangeFromView(opened(), edit, { sourceAt: helperAt, relations }).entered;
    const chained = [
      ...testsDeclaringFromView(opened(), edit, { sourceAt: helperAt }).entered,
      ...importersFromView(opened(), edit, { sourceAt: helperAt, relations }).entered,
    ];

    expect(composed).toEqual([DECLARING]);
    expect([...new Set(chained)]).toEqual(composed);
  });

  it('charges a file handed over under two of its names once, as the composition does', () => {
    const BUILT = 'dist/two.js';
    const twice = { lines: new Map([[SOURCE, []], [BUILT, []]]), hunks: new Map() };
    const knownAs = (file: string): readonly string[] => [SOURCE, BUILT].includes(file) ? [SOURCE, BUILT] : [file];

    const alone = testsEnteringFromView(view(), twice, { knownAs, precision: 'file-use' });

    expect(alone.because).toEqual(testsEnteringFromView(view(), { lines: new Map([[SOURCE, []]]), hunks: new Map() }, { knownAs, precision: 'file-use' }).because);
    expect(narrowByChangeFromView(view(), twice, { knownAs, precision: 'file-use' }).because).toEqual(alone.because);
  });
});

/** An undone file the record can say nothing changed for selects nothing. */
describe('an undone built twin', () => {
  it('selects nothing when only its source is asked a text, and its own rows are unchecked', () => {
    const SOURCE = 'src/two.ts';
    const BUILT = 'dist/two.js';
    const RAN_OVER = 'export const two = 3;\n';
    const record: TestCoverage = {
      version: 3,
      instrumentation: 'fixture-instrumentation',
      commit: 'recorded',
      tests: [{ file: 'test/one.test.ts', complete: true, preconditions: [] }],
      modules: [
        {
          file: BUILT,
          // The run recorded over an edit, and the landing kept the text it ran over.
          sourceDigest: digestString(RAN_OVER),
          instrumented: true,
          blocks: [{ ordinal: 0, kind: 'module', digest: 'block:two', name: '', path: 'module', startLine: 1, endLine: 1, source: true, testFiles: ['test/one.test.ts'] }],
        },
      ],
    };
    const knownAs = (file: string): readonly string[] => ([SOURCE, BUILT].includes(file) ? [SOURCE, BUILT] : [file]);

    const narrowed = narrowByChangeFromView(openTestCoverage(encodeTestCoverage(record)), { lines: new Map(), hunks: new Map() }, {
      knownAs,
      // Only the source has a text at the commit, and it has no row: the built twin's frame is unchecked.
      sourceAt: (file) => (file === SOURCE ? 'export const two = 2;\n' : undefined),
      keptText: (digest) => (digest === digestString(RAN_OVER) ? RAN_OVER : undefined),
      keptDigests: () => [digestString(RAN_OVER)],
    });

    expect(narrowed.entered).toEqual([]);
  });
});

/**
 * A change that names lines and no hunks says where a file moved and not what
 * it became: nothing can apply it to a text, so no parser decides it.
 */
describe('lines with no hunks', () => {
  const SOURCE = 'src/two.ts';
  const ENTERING = 'test/one.test.ts';
  const DECLARING = 'test/two.test.ts';
  const COMMITTED_SOURCE = 'export function two(value) {\n  return value * 2;\n}\n';
  const COMMITTED_TEST = "it('doubles', () => {\n  expect(1).toBe(1);\n});\n";
  const record: TestCoverage = {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    commit: 'recorded',
    tests: [
      { file: ENTERING, complete: true, preconditions: [] },
      // The declaring test ran the text at the commit.
      { file: DECLARING, complete: true, preconditions: [{ name: DECLARING, digest: digestString(COMMITTED_TEST) }] },
    ],
    modules: [
      {
        file: SOURCE,
        sourceDigest: digestString(COMMITTED_SOURCE),
        instrumented: true,
        blocks: [
          { ordinal: 0, kind: 'module', digest: 'block:two', name: '', path: 'module', startLine: 1, endLine: 3, source: true, testFiles: [ENTERING] },
        ],
      },
    ],
  };
  const sourceAt = (file: string): string | undefined => ({ [SOURCE]: COMMITTED_SOURCE, [DECLARING]: COMMITTED_TEST })[file];
  const view = () => openTestCoverage(encodeTestCoverage(record));
  const invented = (file: string) => ({ lines: new Map([[file, [{ start: 2, end: 2 }]]]), hunks: new Map() });

  it('charges a measured file by its lines, with the text at the commit in hand', () => {
    expect(testsEnteringFromView(view(), invented(SOURCE), {}).entered).toEqual([ENTERING]);
    expect(testsEnteringFromView(view(), invented(SOURCE), { sourceAt }).entered).toEqual([ENTERING]);
    expect(narrowByChangeFromView(view(), invented(SOURCE), { sourceAt }).entered).toEqual([ENTERING]);
  });

  it('charges a file whose record was cut from a kept text whole, which the lines cannot be moved onto', () => {
    const KEPT = 'export function two(value) {\n  return value + value;\n}\n';
    const kept = () => openTestCoverage(encodeTestCoverage({ ...record, modules: [{ ...record.modules[0]!, sourceDigest: digestString(KEPT) }] }));
    const options = { sourceAt, keptText: (digest: string) => (digest === digestString(KEPT) ? KEPT : undefined) };

    expect(testsEnteringFromView(kept(), invented(SOURCE), options)).toMatchObject({ entered: [ENTERING], stale: [SOURCE] });
    expect(narrowByChangeFromView(kept(), invented(SOURCE), options)).toMatchObject({ entered: [ENTERING], stale: [SOURCE] });
  });

  it('keeps a declaring test, which ran the text the lines were cut from and not the one they arrive at', () => {
    expect(testsDeclaringFromView(view(), invented(DECLARING), { sourceAt }).entered).toEqual([DECLARING]);
    expect(narrowByChangeFromView(view(), invented(DECLARING), { sourceAt }).entered).toContain(DECLARING);
  });

  it('walks the importers of a rowless file, which no parser read', () => {
    const HELPER = 'src/helper.ts';
    const relations = relationsOf({ relations: [{ from: { kind: 'file', name: ENTERING }, to: { kind: 'file', name: HELPER }, kind: 'imports' }] });
    const helperAt = (file: string): string | undefined => (file === HELPER ? 'export const one = 1;\nexport const two = 2;\n' : sourceAt(file));

    expect(importersFromView(view(), invented(HELPER), { sourceAt: helperAt, relations }).entered).toEqual([ENTERING]);
    expect(narrowByChangeFromView(view(), invented(HELPER), { sourceAt: helperAt, relations }).entered).toEqual([ENTERING]);
  });
});
