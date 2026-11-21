import { describe, expect, it } from 'vitest';
import { coveringTestsInFile, type ExecutionIndex } from './reverse.js';
import { reachOf, stateOf } from './range-state.js';
import { sameUnentered, unenteredSaid, unenteredSentence, type Unentered } from './unentered.js';

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

describe('what a file says once about the regions no case entered on its ranges', () => {
  const at = (kind: string, startLine: number, endLine: number, stopped?: Unentered['stopped']): Unentered =>
    ({ kind, name: `f${startLine}`, path: 'entry', startLine, endLine, ...(stopped === undefined ? {} : { stopped }) });
  const stops = [index.tests[0]!];

  it('names a region its opening and closing lines both hold once, and the unwalked ones in one sentence by kind', () => {
    const said = unenteredSaid([
      at('function', 60, 69, []), at('function', 60, 69, []), at('function', 95, 95, []),
      at('branch', 134, 134, []), at('function', 134, 134, []), at('branch', 188, 188, []),
    ]);

    expect(said).toEqual([{
      sentence: 'No case entered the functions on lines 60-69, 95 and 134, or the branches on lines 134 and 188, and every case that could have reached them finished: unwalked.',
    }]);
  });

  it('keeps each hole apart with the cases that stopped short of it, and one region in the sentence a range says', () => {
    const said = unenteredSaid([at('branch', 6, 8, stops), at('branch', 12, 12, []), at('branch', 6, 8, stops), at('function', 20, 22)]);

    expect(said).toEqual([
      { sentence: 'No case entered the branch on lines 6-8 — a hole: a case that could have reached it stopped first, so the record cannot see it.', stopped: stops },
      { sentence: 'No case entered the branch on line 12, and every case that could have reached it finished: unwalked.' },
      { sentence: 'No case entered the function on lines 20-22.' },
    ]);
  });

  it('says nothing over no region', () => {
    expect(unenteredSaid([])).toEqual([]);
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
