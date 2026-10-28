import { describe, expect, it } from 'vitest';
import { rowOf } from './case-said.js';
import { narrowByJourneys } from './execution-select.js';
import { encodeAsSetExecutionIndex } from './execution-set-format.js';
import type { ExecutionIndex, ExecutionTest } from './reverse.js';
import { decodeExecutionIndex } from './index.js';

// A characterization: these pin what selection already does with rows that
// carry preconditions, and change no code. A named precondition is a state, and
// nothing in a checkout changes it: the cases that said one are selected
// exactly as the same cases saying nothing.

const SAID: readonly ExecutionTest[] = [
  {
    id: 'cart.test.ts > pays mocked', file: 'cart.test.ts', name: 'pays mocked',
    said: JSON.stringify({ said: [['fixture:network', '"mocked"', 'cart.test.ts:4', 1]] }),
  },
  {
    id: 'flow.test.ts > replays', file: 'flow.test.ts', name: 'replays',
    said: JSON.stringify({ said: [['fixture:flag', '"ff-on"', 'flow.test.ts:9', 65535], ['fixture:network', '"recorded"', 'flow.test.ts:3', 0]] }),
  },
  { id: 'quiet.test.ts > says nothing', file: 'quiet.test.ts', name: 'says nothing', said: '{"said":[]}' },
];

function indexOf(tests: readonly ExecutionTest[]): ExecutionIndex {
  return decodeExecutionIndex(encodeAsSetExecutionIndex({
    tests,
    modules: [{
      file: 'src/cart.ts',
      blocks: [
        { kind: 'function', name: 'total', path: 'entry', startLine: 1, endLine: 3, source: true, crossings: [{ test: 0, distance: 0 }] },
        { kind: 'function', name: 'refund', path: 'entry', startLine: 5, endLine: 9, source: true, crossings: [{ test: 1, distance: 0 }] },
      ],
    }],
  }));
}

const said = indexOf(SAID);
const silent = indexOf(SAID.map(({ said: _, ...test }) => test));

describe('a precondition a case said', () => {
  it('travels on its row and is not read by selection', () => {
    expect(said.tests.map((test) => rowOf(test)?.length)).toEqual([1, 2, 0]);
    expect(silent.tests.every((test) => test.said === undefined)).toBe(true);
  });

  it.each([
    ['a region one case entered', new Map([['src/cart.ts', [{ start: 2, end: 2 }]]])],
    ['a region another case entered', new Map([['src/cart.ts', [{ start: 6, end: 6 }]]])],
    ['a path spelled like a precondition name', new Map([['network', [{ start: 1, end: 1 }]]])],
    ['the test file that said it', new Map([['cart.test.ts', [{ start: 4, end: 4 }]]])],
  ])('neither selects nor excludes a case on %s', (_, changed) => {
    expect(narrowByJourneys(said, changed)).toEqual(narrowByJourneys(silent, changed));
  });
});
