// What the fold does to the *tests* of a shard whose crossings it throws away.
//
// `merge.test.ts` covers where an index stands after a fold and which module row
// wins. This file asks the question on the other side of the same erasure: a
// shard that could not instrument a module outvotes the shards that measured it,
// and the tests that made those measurements have to stop being whole
// observations of it, or the fold hands a reader a test it may skip on evidence
// the fold itself deleted.

import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import type { CoveragePrecondition, TestCoverage } from './index.js';
import { coverageBlock } from './instrumented-modules.js';
import { foldTestCoverage } from './merge.js';
import { narrowByExecutionFromView } from './select.js';

const COMMIT = 'c'.repeat(40);
const PRICE = 'src/price.ts';
const SOURCE = [
  'export function total(items) {',
  '  if (items.length > 10) {',
  '    return 0;',
  '  }',
  '  return items.length;',
  '}',
  '',
].join('\n');

const CUT = instrument(SOURCE, PRICE, PRICE, { mode: 'presence' })!;
const BLOCKS = CUT.blocks.map((block) => coverageBlock(SOURCE, block));

/** The node shard's test: this build instrumented `price.ts`, and it entered it. */
const READER = 'test/cart.test.ts';
/** The browser shard's test: this build could not read `price.ts` at all. */
const BROWSER = 'test/story.spec.ts';
/** A test of the node shard that never went near `price.ts`. */
const BYSTANDER = 'test/tax.test.ts';

function testFile(file: string, ...preconditions: CoveragePrecondition[]): TestCoverage['tests'][number] {
  return { file, complete: true, preconditions: [{ name: file, digest: `source:${file}` }, ...preconditions] };
}

/** The shard whose build instrumented `price.ts` and recorded crossings in it. */
const measured: TestCoverage = {
  version: 3,
  instrumentation: INSTRUMENTATION_ID,
  commit: COMMIT,
  tests: [testFile(READER), testFile(BYSTANDER)],
  modules: [
    {
      file: PRICE,
      sourceDigest: CUT.sourceDigest,
      instrumented: true,
      blocks: BLOCKS.map((block) => ({ ...block, testFiles: [READER], loadedBy: [READER] })),
    },
    {
      file: 'src/tax.ts',
      sourceDigest: 'source:tax',
      instrumented: true,
      blocks: [{
        ordinal: 0,
        kind: 'module',
        digest: 'block:tax',
        name: '',
        path: 'module',
        startLine: 1,
        endLine: 4,
        source: true,
        testFiles: [BYSTANDER],
      }],
    },
  ],
};

/**
 * The shard whose build could not read `price.ts`, as the recorders write it:
 * an uninstrumented row, and the same name declared as a precondition of every
 * subject that entered the module — which is what closes `unread` for the file
 * and leaves the fold's widening with nowhere to come out.
 */
const unknown: TestCoverage = {
  version: 3,
  instrumentation: INSTRUMENTATION_ID,
  commit: COMMIT,
  tests: [testFile(BROWSER, { name: PRICE, digest: 'source:price' })],
  modules: [{ file: PRICE, sourceDigest: CUT.sourceDigest, instrumented: false, blocks: [] }],
};

const DIFF = [
  `diff --git a/${PRICE} b/${PRICE}`,
  `--- a/${PRICE}`,
  `+++ b/${PRICE}`,
  '@@ -3,1 +3,0 @@',
  '-    return 0;',
  '',
].join('\n');

/** The caller of `packages/cli/src/commands/select.ts`, on the fold's own answer. */
function skipList(coverage: TestCoverage): readonly string[] {
  const narrowing = narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), DIFF);
  if (narrowing.unread.length > 0) return [];
  const reached = new Set(narrowing.entered);
  return narrowing.whole.filter((test) => !reached.has(test));
}

const complete = (coverage: TestCoverage): readonly (readonly [string, boolean])[] =>
  coverage.tests.map((test) => [test.file, test.complete] as const);

const shards = (order: readonly TestCoverage[]) =>
  order.map((coverage, at) => ({ path: `shard-${at + 1}/coverage.bin`, coverage }));

describe('a fold that erases crossings', () => {
  it('demotes the tests whose crossings the unknown row wiped, in either order', () => {
    for (const order of [[measured, unknown], [unknown, measured]]) {
      const folded = foldTestCoverage(shards(order));

      expect(folded.modules.find((module) => module.file === PRICE))
        .toMatchObject({ instrumented: false, blocks: [] });
      expect(complete(folded)).toEqual([
        [READER, false],
        [BROWSER, true],
        [BYSTANDER, true],
      ]);
    }
  });

  it('keeps the test that lost its evidence out of the skip list', () => {
    // The whole of the point, and the narrowing that has to survive it. `unread`
    // cannot carry this widening: the shard that wrote the uninstrumented row
    // also declared the file, so no reader is ever told it went unmeasured. The
    // bystander is still skipped — the fold widens by the one test whose
    // evidence it deleted, and by nothing else.
    for (const order of [[measured, unknown], [unknown, measured]]) {
      expect(skipList(foldTestCoverage(shards(order)))).toEqual([BYSTANDER]);
    }
    expect(skipList(measured)).toEqual([BYSTANDER]);
  });

  it('demotes a test that only loaded the module, not only one that entered a region', () => {
    const early = {
      ...measured,
      modules: measured.modules.map((module) =>
        module.file === PRICE
          ? { ...module, blocks: module.blocks.map((block) => ({ ...block, testFiles: [], loadedBy: [READER] })) }
          : module,
      ),
    };

    expect(complete(foldTestCoverage(shards([early, unknown])))).toEqual([
      [READER, false],
      [BROWSER, true],
      [BYSTANDER, true],
    ]);
  });

  it('leaves a test alone when the module it recorded is not the one erased', () => {
    const elsewhere = {
      ...unknown,
      modules: [{ file: 'src/other.ts', sourceDigest: 'source:other', instrumented: false, blocks: [] }],
    };

    expect(complete(foldTestCoverage(shards([measured, elsewhere])))).toEqual([
      [READER, true],
      [BROWSER, true],
      [BYSTANDER, true],
    ]);
  });
});
