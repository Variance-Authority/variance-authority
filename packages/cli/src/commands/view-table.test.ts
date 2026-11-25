// compass: variance-authority.reach.crossings
import { describe, expect, it } from 'vitest';
import { listed, type Table } from './view-rows.js';
import { matching, saidBy, sorted, written } from './view-table.js';

/** How a table in the page filters, sorts and writes its rows, apart from drawing them. */

const TABLE: Table = listed({ id: 't', label: 'Tests', hint: '' }, ['file', 'took'], [
  ['src/Slow.test.ts', 4200],
  ['src/fast.test.ts', 90],
  ['src/none.test.ts', undefined],
  ['src/mid.test.ts', 1234],
]);
const ALL = [0, 1, 2, 3];

describe('the filter', () => {
  it('matches any cell, ignoring case, and a number by its digits as typed', () => {
    const said = saidBy(TABLE);
    expect(matching(said, ALL, 'SLOW')).toEqual([0]);
    expect(matching(said, ALL, '1234')).toEqual([3]);
    expect(matching(said, ALL, '1,234')).toEqual([]);
  });

  it('keeps the order it is given, and every row for an empty needle', () => {
    const said = saidBy(TABLE);
    expect(matching(said, [3, 1, 0], 'test')).toEqual([3, 1, 0]);
    expect(matching(said, [2, 0], '')).toEqual([2, 0]);
  });
});

describe('sorting', () => {
  it('orders by a column either way, and keeps absent values last both ways', () => {
    expect(sorted(TABLE, ALL, 1, false)).toEqual([1, 3, 0, 2]);
    expect(sorted(TABLE, ALL, 1, true)).toEqual([0, 3, 1, 2]);
  });

  it('orders text by code unit', () => {
    expect(sorted(TABLE, ALL, 0, false)).toEqual([0, 1, 3, 2]);
  });
});

describe('a cell', () => {
  it('writes a duration in ms below a second and in seconds above, and leaves an absent cell blank', () => {
    expect(written(90, 'ms')).toBe('90 ms');
    expect(written(4200, 'ms')).toBe('4.20 s');
    expect(written(1234)).toBe('1,234');
    expect(written(undefined)).toBe('');
  });
});
