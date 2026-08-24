import { describe, expect, it } from 'vitest';
import { coveringTests, type ExecutionIndex } from './reverse.js';

const index: ExecutionIndex = {
  tests: [
    { id: 'guest', file: 'test/cart.test.ts', name: 'uses the guest price' },
    { id: 'other-staff', file: 'test/other.test.ts', name: 'applies the staff discount' },
    { id: 'staff', file: 'test/cart.test.ts', name: 'applies the staff discount' },
  ],
  modules: [{
    file: 'src/cart/total.ts',
    blocks: [
      {
        kind: 'function',
        name: 'priceOf',
        path: 'entry',
        startLine: 1,
        endLine: 10,
        source: true,
        crossings: [
          { test: 0, distance: 5 },
          { test: 2, distance: 3 },
          { test: 1, distance: 4 },
          { test: 2, distance: 2 },
        ],
      },
      {
        kind: 'branch',
        name: 'priceOf',
        path: 'if#0/then',
        startLine: 3,
        endLine: 5,
        source: true,
        crossings: [{ test: 2, distance: 3 }],
      },
      {
        kind: 'branch',
        name: 'priceOf',
        path: 'if#0/else',
        startLine: 6,
        endLine: 8,
        source: false,
        crossings: [{ test: 0, distance: 6 }],
      },
    ],
  }],
};

describe('coveringTests', () => {
  it('answers a line from its innermost real source region', () => {
    expect(coveringTests(index, { file: 'src/cart/total.ts', line: 4 })).toEqual([
      {
        id: 'staff',
        file: 'test/cart.test.ts',
        name: 'applies the staff discount',
        distance: 3,
      },
    ]);
  });

  it('answers a function with named tests ordered by their minimum depth', () => {
    expect(coveringTests(index, { file: 'src/cart/total.ts', function: 'priceOf' })).toEqual([
      {
        id: 'staff',
        file: 'test/cart.test.ts',
        name: 'applies the staff discount',
        distance: 2,
      },
      {
        id: 'other-staff',
        file: 'test/other.test.ts',
        name: 'applies the staff discount',
        distance: 4,
      },
      {
        id: 'guest',
        file: 'test/cart.test.ts',
        name: 'uses the guest price',
        distance: 5,
      },
    ]);
  });

  it('returns no claim for source the index does not cover', () => {
    expect(coveringTests(index, { file: 'src/cart/total.ts', line: 20 })).toEqual([]);
    expect(coveringTests(index, { file: 'src/cart/total.ts', function: 'missing' })).toEqual([]);
  });
});
