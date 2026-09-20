// What a carried module's rows are re-cut onto when the regions under them were
// renumbered, which is to say when a number stopped meaning the same region.
//
// Half of a region's address is its position among its siblings. `merge.test.ts`
// holds the carry's ordinary cases — text that moved down the file, a region
// that is simply gone — and these are the ones where the text moved sideways
// and every number behind it moved with it.

import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import { layerTestCoverage } from './format-layer.js';
import { encodeTestCoverage } from './format.js';
import { coverageBlock } from './coverage-rows.js';
import { recutRows } from './merge-carry.js';
import { mergeCoverage } from './merge.js';
import type { CoverageModule, TestCoverage } from './index.js';

const BASELINE = '1111111111111111111111111111111111111111';
const LOCAL = '2222222222222222222222222222222222222222';
const ONE = 'test/one.test.ts';
const TWO = 'test/two.test.ts';
const GAMMA = 'test/gamma.test.ts';

/** Two sibling branches: everything the second one holds is numbered behind the first. */
const PICK = `export function pick(n) {
  if (n === 1) {
    return 'one';
  }
  if (n === 2) {
    return 'two';
  }
  return 'none';
}
`;

/** The same function with its first branch deleted: what was `if#1` is cut as `if#0`. */
const FIRST_GONE = `export function pick(n) {
  if (n === 2) {
    return 'two';
  }
  return 'none';
}
`;

/** The same function with a branch added before both: what was `if#0` is cut as `if#1`. */
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

/** The same function with a second one under it: a counter of its own, nothing moved. */
const SIBLING_WRITTEN = `${PICK}export function label(n) {
  if (n > 0) {
    return 'some';
  }
  return 'none';
}
`;

/** The same function with a branch nested inside its first: another counter, nothing moved. */
const NESTED_WRITTEN = PICK.replace(
  "    return 'one';",
  "    if (n === 1) {\n      return 'one';\n    }\n    return 'uno';",
);

/**
 * Which tests entered each region of `PICK`, as running it would have recorded.
 *
 * `one` calls `pick(1)` and returns out of the first branch; `two` calls
 * `pick(2)`, falls past it and returns out of the second. Both reached the
 * module and the function, so both are on every region around them.
 */
function entered(path: string): readonly string[] {
  if (path === 'module' || path === 'entry') return [ONE, TWO];
  if (path === 'if#0/then') return [ONE];
  if (path === 'if#0/else' || path === 'if#0/after' || path === 'if#1/then') return [TWO];
  return [];
}

/** `src/pick.ts` as `source` cuts it, crossed the way running it would have crossed it. */
function recorded(commit: string, source: string): TestCoverage {
  const fresh = instrument(source, 'src/pick.ts', 'src/pick.ts')!;
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: [ONE, TWO].map((file) => ({
      file,
      complete: true,
      preconditions: [{ name: file, digest: 'source:test' }],
    })),
    modules: [{
      file: 'src/pick.ts',
      sourceDigest: fresh.sourceDigest,
      instrumented: true,
      blocks: fresh.blocks.map((block) => {
        const row = coverageBlock(source, block);
        return { ...row, testFiles: [...entered(row.path)] };
      }),
    }],
  };
}

/** A run that recorded one test of its own and loaded no module at all. */
function nothingLoaded(commit: string): TestCoverage {
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: [{ file: GAMMA, complete: true, preconditions: [{ name: GAMMA, digest: 'src:g' }] }],
    modules: [],
  };
}

/** The one module of a carried snapshot, whatever the carry did with it. */
function only(coverage: TestCoverage): CoverageModule {
  return coverage.modules[0]!;
}

const held = (coverage: TestCoverage, path: string): readonly string[] | undefined =>
  only(coverage).blocks.find((block) => block.path === path)?.testFiles;

const complete = (coverage: TestCoverage, file: string): boolean | undefined =>
  coverage.tests.find((test) => test.file === file)?.complete;

describe('recutRows over renumbered siblings', () => {
  it('mislays a module whose sibling regions were renumbered under it', () => {
    // A region's address says where it is in the module's tree, and the steps of
    // that path are counted among siblings in source order. Delete the first of
    // two branches and the second one's regions are cut as `if#0/*` — the
    // address the deleted branch had, over text it never covered — and the kinds
    // match, because a branch replaced a branch. Nothing under the address can
    // tell the two apart, so the numbering is compared before anything is
    // carried and a module that renumbered is mislaid.
    const module = only(recorded(BASELINE, PICK));

    expect(recutRows(module, FIRST_GONE, INSTRUMENTATION_ID)).toBe('mislaid');
    expect(recutRows(module, ONE_ADDED, INSTRUMENTATION_ID)).toBe('mislaid');
  });

  it('re-cuts a module that gained regions of its own', () => {
    // The other half of the rule, and the shape almost every carry has: text
    // written into a module opens counters where nothing was counted before. A
    // function written under `pick` numbers its branch among its own, and a
    // branch nested inside `pick`'s first one numbers itself among the branches
    // of that place — neither moves a region already seated, so neither is a
    // reason to retire what is known about the rest of the file.
    const module = only(recorded(BASELINE, PICK));

    expect(recutRows(module, SIBLING_WRITTEN, INSTRUMENTATION_ID)).not.toBe('mislaid');
    expect(recutRows(module, NESTED_WRITTEN, INSTRUMENTATION_ID)).not.toBe('mislaid');
  });

  it('re-cuts a module whose regions only moved down the file', () => {
    // The control, and the case the re-cut exists for: the same regions in the
    // same places, at later line numbers. Nothing is numbered differently, so
    // every crossing is carried and the rows come out in the coordinates the
    // next diff will be taken in.
    const recut = recutRows(only(recorded(BASELINE, PICK)), `const scale = 2;\n\n${PICK}`,
      INSTRUMENTATION_ID);
    const then = recut === 'mislaid' || recut === undefined
      ? undefined
      : recut.blocks.find((block) => block.path === 'if#0/then');

    expect(then?.startLine).toBe(4);
    expect(then?.testFiles).toEqual([ONE]);
  });
});

describe('mergeCoverage over a renumbered carry', () => {
  it('keeps the tests of a module whose branches were renumbered out of the skip list', () => {
    // `two` is the only test that entered the surviving branch. Carrying the
    // crossings by address hands that branch to `one` — the test recorded
    // against the branch that is gone — and hands `two` nothing, while every row
    // is written with the digest of the text standing now, so the reader that
    // checks a module's coordinates agrees with the tree and widens on nothing.
    // A diff inside the surviving branch is then answered with `one` and skips
    // `two`, the one test known to have run there.
    const merged = mergeCoverage(
      recorded(BASELINE, PICK),
      nothingLoaded(LOCAL),
      new Map([['src/pick.ts', FIRST_GONE]]),
    );

    expect(complete(merged, ONE)).toBe(false);
    expect(complete(merged, TWO)).toBe(false);
    expect(held(merged, 'if#1/then')).toEqual([TWO]);
    expect(only(merged).sourceDigest).toBe(only(recorded(BASELINE, PICK)).sourceDigest);
  });

  it('does not seat a recorded branch on one written before it', () => {
    // The same renumbering from the other side: a branch added before the
    // recorded one. Every region is one seat further down, so `one`'s branch is
    // carried onto the branch that tests `n === 0` and `two`'s onto `one`'s,
    // and the answer to a diff anywhere in the function is the wrong test.
    const merged = mergeCoverage(
      recorded(BASELINE, PICK),
      nothingLoaded(LOCAL),
      new Map([['src/pick.ts', ONE_ADDED]]),
    );

    expect(complete(merged, TWO)).toBe(false);
    expect(only(merged).blocks.every((block) => block.path !== 'if#2/then')).toBe(true);
  });
});

describe('layerTestCoverage over a renumbered carry', () => {
  it('writes the same bytes the merge writes', () => {
    // The layer is the merge with the decode and most of the encode removed, so
    // a rule the merge learned and the layer did not fails here rather than in
    // an index somebody already wrote.
    const previous = recorded(BASELINE, PICK);
    const current = nothingLoaded(LOCAL);
    const onDisk = new Map([['src/pick.ts', FIRST_GONE]]);

    expect(layerTestCoverage(encodeTestCoverage(previous), current, onDisk)).toEqual(
      encodeTestCoverage(mergeCoverage(previous, current, onDisk)),
    );
  });
});
