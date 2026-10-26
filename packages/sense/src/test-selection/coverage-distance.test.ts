import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { coverageAtDistance } from './coverage-distance.js';
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

const callers = (narrowed: ExecutionIndex): readonly (readonly [string, readonly string[]])[] =>
  narrowed.modules.map((module) => [module.file, module.blocks.flatMap((one) => one.crossings.map((crossing) => narrowed.tests[crossing.test]!.id))]);

describe('coverage counted from the tests within a band of import hops', () => {
  it('keeps a crossing only when its test file is within the band of the module it entered', () => {
    const { index: near } = coverageAtDistance(index, { from: 0, to: 1 }, { relations });

    expect(callers(near)).toEqual([
      ['src/button.ts', ['button']],
      ['src/card.ts', ['card']],
      ['src/icon.ts', []],
    ]);
  });

  it('measures the hops over the modules the test entered, not every import it could have followed', () => {
    const { index: far } = coverageAtDistance(index, { from: 2, to: Number.MAX_SAFE_INTEGER }, { relations });

    expect(callers(far)).toEqual([
      ['src/button.ts', ['card']],
      ['src/card.ts', []],
      ['src/icon.ts', ['card', 'button']],
    ]);
  });

  it('leaves out a test file the graph cannot place, and names it, since an unmeasured distance is not a short one', () => {
    const { index: near, unplaced } = coverageAtDistance(index, { from: 0, to: Number.MAX_SAFE_INTEGER }, { relations });

    expect(unplaced).toEqual(['test/stray.test.ts']);
    expect(callers(near).find(([file]) => file === 'src/icon.ts')).toEqual(['src/icon.ts', ['card', 'button']]);
  });

  it('keeps every region, crossed or not, so the band narrows what ran and never what loaded', () => {
    const { index: near } = coverageAtDistance(index, { from: 0, to: 0 }, { relations });

    expect(near.modules.map((module) => module.blocks.length)).toEqual([1, 1, 1]);
    expect(near.tests).toBe(index.tests);
  });
});
