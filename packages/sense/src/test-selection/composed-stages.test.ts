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
});
