import { describe, expect, it } from 'vitest';
import { coveringTestsInFile, type ExecutionIndex } from './reverse.js';

/**
 * `total` spans lines 4-8, and the branch on line 6 is one line long: every
 * line of it also charges `total`, so the cases an edit to it selects are
 * `total`'s, and the branch's own emptiness is on no range unless the range
 * says so.
 */
const index: ExecutionIndex = {
  tests: [{ id: 'a.test.ts > adds', file: 'a.test.ts', name: 'adds', stopped: false }],
  modules: [{
    file: 'src/cart.ts',
    blocks: [
      { kind: 'function', name: 'total', path: 'entry', startLine: 4, endLine: 8, source: true, crossings: [{ test: 0, distance: 0 }] },
      { kind: 'branch', name: 'total', path: 'if#0/then', startLine: 6, endLine: 6, source: true, crossings: [] },
    ],
  }],
};

describe('a region no case entered, on lines a region around it charges', () => {
  it('is named on the range that holds it, so the file answer does not fold it into its neighbours', () => {
    const ranges = coveringTestsInFile(index, 'src/cart.ts');

    expect(ranges.map((range) => [range.startLine, range.endLine, range.tests.map((test) => test.name), range.unentered])).toEqual([
      [4, 5, ['adds'], undefined],
      [6, 6, ['adds'], [{ kind: 'branch', name: 'total', path: 'if#0/then', startLine: 6, endLine: 6, stopped: [] }]],
      [7, 8, ['adds'], undefined],
    ]);
  });

  it('is not named on a range whose cases are none, which already says nobody entered it', () => {
    const alone: ExecutionIndex = { ...index, modules: [{ file: 'src/cart.ts', blocks: [index.modules[0]!.blocks[1]!] }] };

    expect(coveringTestsInFile(alone, 'src/cart.ts')).toEqual([{ startLine: 6, endLine: 6, tests: [], stopped: [] }]);
  });
});
