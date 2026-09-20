// A region that did not exist when a test was recorded: what the merge says
// about it, through the object model and through the columns.
//
// Kept beside `merge.test.ts` rather than in it because that file is at the
// length limit, and because this is one question asked four ways — the carry
// path and the re-recorded path, each of them twice.

import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import { encodeTestCoverage } from './format.js';
import { layerTestCoverage } from './format-layer.js';
import { openTestCoverage } from './format-view.js';
import type { CoverageBlock, TestCoverage } from './index.js';
import { coverageBlock } from './coverage-rows.js';
import { mergeCoverage } from './merge.js';
import { narrowByExecutionFromView } from './select.js';

const BASELINE = '1111111111111111111111111111111111111111';
const LOCAL = '2222222222222222222222222222222222222222';
const PRICE = 'src/price.ts';

const CART = 'test/cart.test.ts';
const CHECKOUT = 'test/checkout.test.ts';
const OTHER = 'test/other.test.ts';

/** The text both tests were recorded over: one function, and they run it. */
const BEFORE = ['export function total(items) {', '  return items.length;', '}', ''].join('\n');

/**
 * The same module after a commit that carves `discount` out of `total`.
 *
 * `total` still does what it did and both tests still reach every line of it —
 * the edit moved the work rather than adding a branch nobody runs, which is
 * what an extracted helper is. Nothing here is numbered: `discount` is a
 * declaration with a name, so both cuts address it by that name and no seat
 * anywhere in the module changes hands.
 */
const AFTER = [
  'function discount(n) {',
  '  const off = n - 1;',
  '  return off;',
  '}',
  'export function total(items) {',
  '  return discount(items.length);',
  '}',
  '',
].join('\n');

/** The module's rows as the recorder would cut them from this text. */
function rowsOf(source: string): { digest: string; blocks: readonly CoverageBlock[] } {
  const parsed = instrument(source, PRICE, PRICE, { mode: 'presence' })!;
  return {
    digest: parsed.sourceDigest,
    blocks: parsed.blocks.map((block) => coverageBlock(source, block)),
  };
}

/** A whole recording of `src/price.ts` over `source`, every region crossed by `tests`. */
function recorded(source: string, commit: string, tests: readonly string[]): TestCoverage {
  const { digest, blocks } = rowsOf(source);
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: tests.map((file) => ({
      file,
      complete: true,
      preconditions: [{ name: file, digest: `source:${file}` }],
    })),
    modules: [
      {
        file: PRICE,
        sourceDigest: digest,
        instrumented: true,
        blocks: blocks.map((block) => ({ ...block, testFiles: [...tests] })),
      },
    ],
  };
}

/** A run that recorded one test file and loaded nothing the index holds. */
function ranOnly(test: string, commit: string): TestCoverage {
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: [{ file: test, complete: true, preconditions: [{ name: test, digest: `source:${test}` }] }],
    modules: [],
  };
}

/** A one-line edit to `src/price.ts`, as a diff of the text after the commit. */
function edit(line: number): string {
  const text = AFTER.split('\n')[line - 1]!;
  return [
    `diff --git a/${PRICE} b/${PRICE}`,
    `--- a/${PRICE}`,
    `+++ b/${PRICE}`,
    `@@ -${line},1 +${line},1 @@`,
    `-${text}`,
    `+${text} // touched`,
    '',
  ].join('\n');
}

/** Which tests a snapshot answers a diff with, and which it leaves to be skipped. */
function asked(coverage: Uint8Array | TestCoverage, diff: string): {
  whole: readonly string[];
  entered: readonly string[];
  unread: readonly string[];
  skip: readonly string[];
} {
  const bytes = coverage instanceof Uint8Array ? coverage : encodeTestCoverage(coverage);
  const narrowed = narrowByExecutionFromView(openTestCoverage(bytes), diff);
  const entered = new Set(narrowed.entered);
  return {
    whole: narrowed.whole,
    entered: narrowed.entered,
    unread: narrowed.unread,
    skip: narrowed.unread.length > 0 ? [] : narrowed.whole.filter((test) => !entered.has(test)),
  };
}

/**
 * The interior lines of `discount`. Neither is the declaration, so neither
 * charges the module root by sharing a line with it: they are answered by the
 * new region or by nothing.
 */
const INSIDE = [2, 3];

describe('a region born between two runs', () => {
  describe('a module this run did not load, re-cut from the text it has now', () => {
    /**
     * The baseline is the whole suite over the old text. Then somebody commits
     * the extraction and runs one unrelated file, which loads nothing in
     * `src/price.ts` — so the module is carried, and carried across text that
     * moved.
     */
    const merged = (): TestCoverage =>
      mergeCoverage(
        recorded(BEFORE, BASELINE, [CART, CHECKOUT]),
        ranOnly(OTHER, LOCAL),
        new Map([[PRICE, AFTER]]),
      );

    it.each(INSIDE)('answers line %i with the tests that reach it', (line) => {
      expect(asked(merged(), edit(line)).entered).toEqual([CART, CHECKOUT]);
    });

    it('leaves both crossers whole rather than demoting them', () => {
      expect(merged().tests.map((test) => [test.file, test.complete])).toEqual([
        [CART, true],
        [CHECKOUT, true],
        [OTHER, true],
      ]);
    });

    it('still answers the untouched function with its own crossings', () => {
      // The control: nothing here widened the module into one answer for
      // every line of it.
      const answer = asked(merged(), edit(6));
      expect(answer.entered).toEqual([CART, CHECKOUT]);
      expect(answer.skip).toEqual([OTHER]);
    });

    it('hands the new region the crossings of the region around it', () => {
      const priced = merged().modules.find((module) => module.file === PRICE)!;
      const inside = priced.blocks.filter((block) => block.name === 'discount');
      expect(inside.length).toBeGreaterThan(0);
      for (const block of inside) expect(block.testFiles).toEqual([CART, CHECKOUT]);
    });
  });

  describe('a module a subset run re-recorded', () => {
    /**
     * The same commit, but this time the developer re-ran `checkout` alone. The
     * module comes back whole from that run, with `checkout` on every region of
     * it — and `cart`, which nobody re-ran, is carried from the baseline onto
     * the regions it still has an address for. The new region has no address
     * there.
     */
    const merged = (): TestCoverage =>
      mergeCoverage(
        recorded(BEFORE, BASELINE, [CART, CHECKOUT]),
        recorded(AFTER, LOCAL, [CHECKOUT]),
        new Map(),
      );

    it.each(INSIDE)('answers line %i with the carried crosser too', (line) => {
      expect(asked(merged(), edit(line)).entered).toEqual([CART, CHECKOUT]);
    });

    it('records what the run itself saw beside what was carried', () => {
      const priced = merged().modules.find((module) => module.file === PRICE)!;
      const root = priced.blocks.find((block) => block.kind === 'module')!;
      expect(root.testFiles).toEqual([CART, CHECKOUT]);
    });
  });

  describe('through the columns', () => {
    const baseline = (): Uint8Array => encodeTestCoverage(recorded(BEFORE, BASELINE, [CART, CHECKOUT]));

    it.each(INSIDE)('carries a re-cut module onto line %i', (line) => {
      const bytes = layerTestCoverage(baseline(), ranOnly(OTHER, LOCAL), new Map([[PRICE, AFTER]]));
      expect(asked(bytes, edit(line)).entered).toEqual([CART, CHECKOUT]);
    });

    it.each(INSIDE)('keeps the carried crosser on line %i of a re-recorded module', (line) => {
      const bytes = layerTestCoverage(baseline(), recorded(AFTER, LOCAL, [CHECKOUT]), new Map());
      expect(asked(bytes, edit(line)).entered).toEqual([CART, CHECKOUT]);
    });
  });
});
