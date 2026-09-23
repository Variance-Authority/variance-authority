// What the fold does to the *tests* of a shard beside one that could not read
// the module they entered.
//
// `merge.test.ts` covers where an index stands after a fold and which module row
// wins. This file asks the question on the tests' side: a shard that could not
// instrument a module says nothing about the tests another shard watched enter
// it, so their crossings stand, they stay whole observations, and the one shard's
// own subjects are answered by what they declared.

import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import type { CoveragePrecondition, TestCoverage } from './index.js';
import { coverageBlock } from './coverage-rows.js';
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
 * subject that entered the module — which is what answers for that shard's
 * subjects whichever row the fold keeps.
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

/** A second shard that measured `price.ts`, so the fold holds two witnesses of it. */
const CHECKOUT = 'test/checkout.test.ts';
const alsoMeasured: TestCoverage = {
  ...measured,
  tests: [testFile(CHECKOUT)],
  modules: [{ ...measured.modules[0]!, blocks: BLOCKS.map((block) => ({ ...block, testFiles: [CHECKOUT] })) }],
};

/** What a reader of the fold's own answer is told about the diff. */
const narrowed = (coverage: TestCoverage) =>
  narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), DIFF);

/** Each selected test, by the kinds of evidence that selected it. */
const selectedBy = (coverage: TestCoverage) =>
  narrowed(coverage).because.map((cause) => [cause.test, [...new Set(cause.via.map((reason) => reason.kind))]]);

/** The caller of `packages/cli/src/commands/select.ts`: every whole test nothing selected. */
function skipList(coverage: TestCoverage): readonly string[] {
  const narrowing = narrowed(coverage);
  const selected = new Set(narrowing.entered);
  return narrowing.whole.filter((test) => !selected.has(test));
}

const complete = (coverage: TestCoverage): readonly (readonly [string, boolean])[] =>
  coverage.tests.map((test) => [test.file, test.complete] as const);

const shards = (order: readonly TestCoverage[]) =>
  order.map((coverage, at) => ({ path: `shard-${at + 1}/coverage.bin`, coverage }));

const price = (coverage: TestCoverage) => coverage.modules.find((module) => module.file === PRICE);

/** Every order the shards could be named in. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]));
}

describe('a fold beside a shard that could not instrument a module', () => {
  it('keeps the measured row and every test whole, in either order', () => {
    for (const order of [[measured, unknown], [unknown, measured]]) {
      const folded = foldTestCoverage(shards(order));

      expect(price(folded)?.instrumented).toBe(true);
      expect(price(folded)?.blocks.map((block) => block.testFiles)).toEqual(BLOCKS.map(() => [READER]));
      expect(complete(folded)).toEqual([
        [READER, true],
        [BROWSER, true],
        [BYSTANDER, true],
      ]);
    }
  });

  it('is the same fold in every order the shards are read in', () => {
    // An instrumented row replaces an unknown one whenever it arrives, and an
    // unknown one never displaces a measurement, so where the blind shard falls
    // among the measuring ones changes nothing — first, between them, or last.
    const [first, ...rest] = permutations([measured, unknown, alsoMeasured])
      .map((order) => foldTestCoverage(shards(order)));

    expect(rest).toHaveLength(5);
    for (const folded of rest) expect(folded).toEqual(first);
    expect(price(first!)?.blocks.map((block) => block.testFiles)).toEqual(BLOCKS.map(() => [READER, CHECKOUT]));
  });

  it('selects the measured test by its region and the blind shard\'s by its declaration', () => {
    // The blind shard's subject never needed the row: its recorder declared the
    // file, and a declaration holds whichever row the fold keeps. The bystander
    // is skipped, as it is in the measuring shard alone.
    for (const order of [[measured, unknown], [unknown, measured]]) {
      const folded = foldTestCoverage(shards(order));

      expect(selectedBy(folded)).toEqual([
        [READER, ['region']],
        [BROWSER, ['precondition']],
      ]);
      expect(skipList(folded)).toEqual([BYSTANDER]);
    }
    expect(skipList(measured)).toEqual([BYSTANDER]);
  });

  it('keeps a test that only loaded the module on the row, and whole', () => {
    const early = {
      ...measured,
      modules: measured.modules.map((module) =>
        module.file === PRICE
          ? { ...module, blocks: module.blocks.map((block) => ({ ...block, testFiles: [], loadedBy: [READER] })) }
          : module,
      ),
    };

    for (const order of [[early, unknown], [unknown, early]]) {
      const folded = foldTestCoverage(shards(order));

      expect(price(folded)?.blocks.map((block) => block.loadedBy)).toEqual(BLOCKS.map(() => [READER]));
      expect(complete(folded).every(([, whole]) => whole)).toBe(true);
    }
  });

  it('keeps an uninstrumented row where no shard measured the module', () => {
    const blindToo: TestCoverage = { ...unknown, tests: [testFile('test/other.spec.ts')] };
    const elsewhere = {
      ...unknown,
      modules: [{ file: 'src/other.ts', sourceDigest: 'source:other', instrumented: false, blocks: [] }],
    };

    for (const order of [[unknown, blindToo], [blindToo, unknown]]) {
      expect(foldTestCoverage(shards(order)).modules)
        .toEqual([{ file: PRICE, sourceDigest: CUT.sourceDigest, instrumented: false, blocks: [] }]);
    }
    const folded = foldTestCoverage(shards([measured, elsewhere]));
    expect(folded.modules.find((module) => module.file === 'src/other.ts')?.instrumented).toBe(false);
    expect(price(folded)?.instrumented).toBe(true);
    expect(complete(folded).every(([, whole]) => whole)).toBe(true);
  });
});
