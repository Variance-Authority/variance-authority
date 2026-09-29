import type { JourneyMap } from '@variance-authority/sense';
import { describe, expect, it } from 'vitest';
import { formatJourneyMap } from './journey-map-format.js';
import { termsOf } from './journey-map.js';

const at = (name: string, file = 'src/a.ts', line = 1) => ({ name, file, line, end: line + 3 });
const test = (case_: number, name: string, blocks: number, alike?: number) => ({ case: case_, file: 'a.test.ts', name, blocks, ...(alike === undefined ? {} : { alike }) });

const map: JourneyMap = {
  file: 'src/a.ts',
  suite: 100,
  entered: 10,
  kept: 2,
  tests: [test(1, 'small', 3, 1), test(2, 'large', 9, 0)],
  functions: [
    { function: at('one'), cases: 2, paths: [{ cases: 2, files: 1, entered: [], median: 6, smallest: test(1, 'small', 3), passage: true }] },
    {
      function: at('two', 'src/a.ts', 9),
      cases: 2,
      paths: [
        { cases: 1, files: 1, entered: [{ kind: 'branch', file: 'src/a.ts', line: 10, end: 11 }], median: 3, smallest: test(1, 'small', 3), passage: true },
        { cases: 1, files: 1, entered: [{ kind: 'branch', file: 'src/a.ts', line: 12, end: 13 }], median: 9, smallest: test(2, 'large', 9), passage: false },
      ],
    },
  ],
  spine: [{ function: at('shared', 'src/b.ts', 5), cases: 2, nearest: test(1, 'small', 3) }],
  branches: [{ cases: 1, places: [at('only', 'src/c.ts', 7)], smallest: test(2, 'large', 9) }],
  structure: 4,
};

describe('the journey map as text', () => {
  it('states the counts, collapses a single path to a line, expands several, and says what structure it left out', () => {
    expect(formatJourneyMap(map, ['pay']).split('\n')).toEqual([
      'src/a.ts: 10 of 100 recorded tests entered it; 2 kept (tests named for `pay`).',
      '',
      'Kept tests, smallest journey first:',
      '  a.test.ts  small  (3 regions, 1 other the same)',
      '  a.test.ts  large  (9 regions)',
      '',
      'Inside src/a.ts, by function:',
      'src/a.ts:1  one: 2 of 2 kept tests',
      'src/a.ts:9  two: 2 of 2 kept tests, by 2 paths',
      '    passage  1 test  branch at line 10  smallest small',
      '    branch   1 test  branch at line 12  smallest large',
      '',
      '4 functions beyond the file are structure: the kept tests and at least half of the 100 recorded tests enter them, so they are not drawn.',
      '',
      'Beyond the file, entered by most of the 2 kept tests, nearest first:',
      '  src/b.ts:5  shared  2 tests; nearest small',
      '',
      'Beyond the file, entered by only some of the kept tests, most tests first:',
      '  1 test, smallest large: src/c.ts:7 only',
    ]);
  });

  it('stops at the counts when the task kept nothing', () => {
    expect(formatJourneyMap({ ...map, kept: 0, tests: [] }, [])).toBe(
      'src/a.ts: 10 of 100 recorded tests entered it; 0 kept (every test that entered it).',
    );
  });

  it('reads the words of a task from a string, apart from blanks', () => {
    expect(termsOf({ query: ' pay   checkout ' })).toEqual(['pay', 'checkout']);
    expect(termsOf({})).toEqual([]);
  });
});
