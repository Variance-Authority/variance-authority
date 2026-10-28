import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { coverageAtDistance as narrowed, testHops } from './coverage-distance.js';
import type { DistanceOptions } from './distance.js';
import type { ExecutionBlock, ExecutionIndex } from './reverse.js';

// card.test imports card, card imports button, button imports icon.
const relations = relationsOfFiles([
  { file: 'src/icon.ts', edges: [] },
  { file: 'src/button.ts', edges: [{ to: 'src/icon.ts', kind: 'imports' }] },
  { file: 'src/card.ts', edges: [{ to: 'src/button.ts', kind: 'imports' }] },
  { file: 'test/card.test.ts', edges: [{ to: 'src/card.ts', kind: 'imports' }] },
  { file: 'test/button.test.ts', edges: [{ to: 'src/button.ts', kind: 'imports' }] },
]);

const CARD = { id: 'card', file: 'test/card.test.ts', name: 'renders', stopped: false };
const BUTTON = { id: 'button', file: 'test/button.test.ts', name: 'clicks', stopped: false };
const STRAY = { id: 'stray', file: 'test/stray.test.ts', name: 'wanders', stopped: false };

function block(tests: readonly number[], extra: Partial<ExecutionBlock> = {}): ExecutionBlock {
  return {
    kind: 'function', name: 'run', path: 'run', startLine: 1, endLine: 3, source: true,
    crossings: tests.map((test) => ({ test, distance: 0 })), ...extra,
  };
}

const index: ExecutionIndex = {
  tests: [CARD, BUTTON, STRAY],
  modules: [
    { file: 'src/button.ts', blocks: [block([0, 1])] },
    { file: 'src/card.ts', blocks: [block([0])] },
    { file: 'src/icon.ts', blocks: [block([0, 1, 2])] },
  ],
};

const coverageAtDistance = (indexes: readonly ExecutionIndex[], band: { from: number; to: number }, options: DistanceOptions) =>
  narrowed(indexes, band, testHops(indexes, options));

const callers = (narrowed: ExecutionIndex): readonly (readonly [string, readonly string[]])[] =>
  narrowed.modules.map((module) => [module.file, module.blocks.flatMap((one) => one.crossings.map((crossing) => narrowed.tests[crossing.test]!.id))]);

describe('coverage counted from the tests within a band of import hops', () => {
  it('keeps a crossing only when its test file is within the band of the module it entered', () => {
    const { indexes: [near] } = coverageAtDistance([index], { from: 0, to: 1 }, { relations });

    expect(callers(near!)).toEqual([
      ['src/button.ts', ['button']],
      ['src/card.ts', ['card']],
      ['src/icon.ts', []],
    ]);
  });

  it('counts a region under the band of the nearest test that ran it, so a far band holds only what no nearer test ran', () => {
    const { indexes: [far] } = coverageAtDistance([index], { from: 2, to: Number.MAX_SAFE_INTEGER }, { relations });

    // button.ts is one hop from button.test, so card.test two hops away does not hold it far.
    expect(callers(far!)).toEqual([
      ['src/button.ts', []],
      ['src/card.ts', []],
      ['src/icon.ts', ['card', 'button']],
    ]);
  });

  it('measures the hops over the modules the test entered, not every import it could have followed', () => {
    // card.test entered icon.ts without button.ts, so no walk reaches icon through the import it never took.
    const skipped: ExecutionIndex = { tests: [CARD], modules: [{ file: 'src/card.ts', blocks: [block([0])] }, { file: 'src/icon.ts', blocks: [block([0]), block([0], { source: false })] }] };
    const { indexes: [near], unplaced, unmeasured } = coverageAtDistance([skipped], { from: 0, to: Number.MAX_SAFE_INTEGER }, { relations });

    expect(unplaced).toEqual([]);
    expect(callers(near!)).toEqual([['src/card.ts', ['card']], ['src/icon.ts', []]]);
    // Only the source region counts; the block the source index does not hold is no region.
    expect(unmeasured).toBe(1);
  });

  it('takes the nearest test across every suite, so a region one suite runs near is near for all of them', () => {
    const unit: ExecutionIndex = { tests: [BUTTON], modules: [{ file: 'src/button.ts', blocks: [block([0])] }] };
    const e2e: ExecutionIndex = { tests: [CARD], modules: [{ file: 'src/card.ts', blocks: [block([0])] }, { file: 'src/button.ts', blocks: [block([0])] }] };
    const { indexes: [, far] } = coverageAtDistance([unit, e2e], { from: 2, to: Number.MAX_SAFE_INTEGER }, { relations });

    expect(callers(far!)).toEqual([['src/card.ts', []], ['src/button.ts', []]]);
  });

  it('leaves out a test file the graph cannot place, and names it, since an unmeasured distance is not a short one', () => {
    const { indexes: [near], unplaced } = coverageAtDistance([index], { from: 0, to: Number.MAX_SAFE_INTEGER }, { relations });

    expect(unplaced).toEqual(['test/stray.test.ts']);
    expect(callers(near!).find(([file]) => file === 'src/icon.ts')).toEqual(['src/icon.ts', ['card', 'button']]);
  });

  it('places a region by the tests that called into it, and keeps the crossings that only loaded it in every band', () => {
    // button.test only loaded button.ts; card.test, two hops away, called into it.
    const loaded: ExecutionIndex = {
      tests: [CARD, BUTTON],
      modules: [
        { file: 'src/card.ts', blocks: [block([0])] },
        { file: 'src/button.ts', blocks: [{ ...block([0]), crossings: [{ test: 0, distance: 0 }, { test: 1, distance: 0, loaded: true }] }] },
      ],
    };
    const { indexes: [far], unmeasured } = coverageAtDistance([loaded], { from: 2, to: Number.MAX_SAFE_INTEGER }, { relations });
    const { indexes: [near] } = coverageAtDistance([loaded], { from: 0, to: 1 }, { relations });

    expect(callers(far!)).toEqual([['src/card.ts', []], ['src/button.ts', ['card', 'button']]]);
    expect(callers(near!)).toEqual([['src/card.ts', ['card']], ['src/button.ts', ['button']]]);
    expect(unmeasured).toBe(0);
  });

  it('keeps every region, crossed or not, so the band narrows what ran and never what loaded', () => {
    const { indexes: [near] } = coverageAtDistance([index], { from: 0, to: 0 }, { relations });

    expect(near!.modules.map((module) => module.blocks.length)).toEqual([1, 1, 1]);
    expect(near!.tests).toBe(index.tests);
  });
});
