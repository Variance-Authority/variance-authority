import { describe, expect, it } from 'vitest';
import { coveringTestsInFile, type ExecutionIndex } from './reverse.js';
import { reachOf, stateOf } from './range-state.js';
import { sameUnentered, unenteredSentence, type Unentered } from './unentered.js';

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

  it('is not one a case ran in another text there, which is not known not to have entered it', () => {
    const tests = [...index.tests, { id: 'a.test.ts > rounds', file: 'a.test.ts', name: 'rounds', stopped: false }];
    const overwritten: ExecutionIndex = { tests, modules: [{ file: 'src/cart.ts', blocks: [
      index.modules[0]!.blocks[0]!,
      { ...index.modules[0]!.blocks[1]!, crossings: [{ test: 1, distance: 0, overwritten: true }] },
    ] }] };

    const branch = coveringTestsInFile(overwritten, 'src/cart.ts').find((range) => range.startLine === 6);
    expect(branch?.unentered).toBeUndefined();
    expect(branch?.overwritten).toEqual([tests[1]]);
  });

  it('is named on the opening line of a longer region, whose other lines say it on their own', () => {
    const longer: ExecutionIndex = { ...index, modules: [{ file: 'src/cart.ts', blocks: [
      { kind: 'function', name: 'total', path: 'entry', startLine: 3, endLine: 10, source: true, crossings: [{ test: 0, distance: 0 }] },
      { kind: 'branch', name: 'total', path: 'if#0/then', startLine: 5, endLine: 8, source: true, crossings: [] },
    ] }] };

    expect(coveringTestsInFile(longer, 'src/cart.ts').map((range) => [range.startLine, range.endLine, range.tests.length, range.unentered?.length])).toEqual([
      [3, 4, 1, undefined],
      [5, 5, 1, 1],
      [6, 8, 0, undefined],
      [9, 10, 1, undefined],
    ]);
  });
});

describe('two ranges\' unentered regions', () => {
  const region = (name: string): Unentered => ({ kind: 'branch', name, path: 'if#0/then', startLine: 6, endLine: 6 });

  it('are not the same when they are another function\'s branch on the same line', () => {
    expect(sameUnentered([region('total')], [region('round')])).toBe(false);
    expect(sameUnentered([region('total')], [region('total')])).toBe(true);
  });
});

describe('the sentence for a region no case entered', () => {
  const branch: Unentered = { kind: 'branch', name: 'total', path: 'if#0/then', startLine: 6, endLine: 8 };

  it('says why: unwalked, a hole, or neither when the record cannot tell', () => {
    expect(unenteredSentence({ ...branch, stopped: [] })).toBe('no case entered the branch on lines 6-8, and every case that could have reached it finished: unwalked.');
    expect(unenteredSentence({ ...branch, stopped: [index.tests[0]!] }))
      .toBe('no case entered the branch on lines 6-8 — a hole: a case that could have reached it stopped first, so the record cannot see it.');
    expect(unenteredSentence(branch)).toBe('no case entered the branch on lines 6-8.');
  });
});

describe('the state of a region no case entered', () => {
  it('is its reach, the word a range no case entered carries: unwalked, a hole, or none when the record cannot tell', () => {
    for (const stopped of [[], [index.tests[0]!], undefined]) {
      const record = { tests: [], ...(stopped === undefined ? {} : { stopped }) };
      expect(stateOf(record) ?? 'unknown').toBe(reachOf(record));
    }
  });
});
