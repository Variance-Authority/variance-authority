// The other half of what `merge-renumber.test.ts` holds: a module this run did
// re-record, whose regions took different seats between the two recordings.
//
// The carry re-cuts a module nobody loaded and asks `sameNumbering` before it
// places a crossing. The merge's re-recorded walk places the previous rows
// against the rows that came in, by the same addresses, and half of an address
// is a seat — so the same slide is available there, and nothing in the carry's
// answer reaches it.

import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import { coverageBlock } from './coverage-rows.js';
import { mergeCoverage } from './merge.js';
import type { CoverageModule, TestCoverage } from './index.js';

const BASELINE = '1111111111111111111111111111111111111111';
const LOCAL = '2222222222222222222222222222222222222222';
const ONE = 'test/one.test.ts';
const TWO = 'test/two.test.ts';
const PICK = 'src/pick.ts';

/** Two sibling branches: everything the second one holds is numbered behind the first. */
const SOURCE = `export function pick(n) {
  if (n === 1) {
    return 'one';
  }
  if (n === 2) {
    return 'two';
  }
  return 'none';
}
`;

/** The same function with a branch written before both: what was `if#0` is cut as `if#1`. */
const ONE_ADDED = `export function pick(n) {
  if (n === 0) {
    return 'zero';
  }
  if (n === 1) {
    return 'one';
  }
  if (n === 2) {
    return 'two';
  }
  return 'none';
}
`;

/** The same regions in the same seats, further down the file. */
const MOVED = `const scale = 2;\n\n${SOURCE}`;

/**
 * Which tests entered each region of {@link SOURCE}, as running it would have
 * recorded: `one` returns out of the first branch, `two` falls past it into the
 * second, and both reached the module and the function on the way.
 */
function entered(path: string): readonly string[] {
  if (path === 'module' || path === 'entry') return [ONE, TWO];
  if (path === 'if#0/then') return [ONE];
  if (path === 'if#0/else' || path === 'if#0/after' || path === 'if#1/then') return [TWO];
  return [];
}

const test = (file: string, complete: boolean) => ({
  file,
  complete,
  preconditions: [{ name: file, digest: 'source:test' }],
});

function cut(source: string, crossed: (path: string) => readonly string[]): CoverageModule {
  const fresh = instrument(source, PICK, PICK)!;
  return {
    file: PICK,
    sourceDigest: fresh.sourceDigest,
    instrumented: true,
    blocks: fresh.blocks.map((block) => {
      const row = coverageBlock(source, block);
      return { ...row, testFiles: [...crossed(row.path)] };
    }),
  };
}

/** The full run at the baseline: both tests whole, every region crossed as running it would. */
const recorded: TestCoverage = {
  version: 3,
  instrumentation: INSTRUMENTATION_ID,
  commit: BASELINE,
  tests: [test(ONE, true), test(TWO, true)],
  modules: [cut(SOURCE, entered)],
};

/** `two` re-run over the text standing now, dying after the module loaded. */
function partial(source: string): TestCoverage {
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit: LOCAL,
    tests: [test(TWO, false)],
    modules: [cut(source, (path) => (path === 'module' || path === 'entry' ? [TWO] : []))],
  };
}

const held = (coverage: TestCoverage, path: string): readonly string[] | undefined =>
  coverage.modules[0]!.blocks.find((block) => block.path === path)?.testFiles;

const complete = (coverage: TestCoverage, file: string): boolean | undefined =>
  coverage.tests.find((file_) => file_.file === file)?.complete;

describe('mergeCoverage over a re-recorded module that changed seats', () => {
  it('does not seat a recorded branch on one written before it', () => {
    // `two` re-ran and did not finish, so it is not retired and its previous
    // crossings are carried; `one` did not run at all, so its are carried too.
    // Every previous address is answered by an address in the new cut, one seat
    // further down — `one`'s branch by the branch testing `n === 0`, `two`'s by
    // `one`'s — and no row is left unmatched, so nothing is demoted to answer
    // for it. A diff on the line `one` is the only test known to have run is
    // then answered with `two`, and `one` is whole and in the caller's skip
    // list.
    const merged = mergeCoverage(recorded, partial(ONE_ADDED));

    expect(complete(merged, ONE)).toBe(false);
    expect(held(merged, 'if#1/then')).toEqual([]);
    expect(held(merged, 'if#0/then')).toEqual([]);
  });

  it('carries every crossing when the seats did not move', () => {
    // The control, and the shape almost every re-record has: the same regions
    // in the same seats at later lines. Nothing is numbered differently, so
    // `one` keeps its branch and stays whole.
    const merged = mergeCoverage(recorded, partial(MOVED));

    expect(complete(merged, ONE)).toBe(true);
    expect(held(merged, 'if#0/then')).toEqual([ONE]);
    expect(held(merged, 'if#1/then')).toEqual([TWO]);
  });

  it('carries a re-record of the text it recorded without counting a seat', () => {
    // The cheapest and commonest case: the run loaded the module and nothing
    // about it had moved. Two rows built from one text are one numbering, so
    // the digests settle it and the seats are never read.
    const merged = mergeCoverage(recorded, partial(SOURCE));

    expect(complete(merged, ONE)).toBe(true);
    expect(held(merged, 'if#0/then')).toEqual([ONE]);
  });
});
