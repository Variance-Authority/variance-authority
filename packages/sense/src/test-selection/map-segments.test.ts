import { describe, expect, it } from 'vitest';
import { decode, shifted } from './map-segments.js';

describe('a map moved past text prepended to its first line', () => {
  it('moves every column of the first line and no other', () => {
    // Line 1: columns 0 and 4; line 2: column 2.
    const mappings = 'AAAA,IAAI;EACA';
    const moved = shifted(mappings, 10);

    expect(decode(moved).map((line) => line.map((segment) => segment.column))).toEqual([[10, 14], [2]]);
  });

  it('leaves a map whose first line holds nothing as it is', () => {
    expect(shifted(';AACA', 10)).toBe(';AACA');
  });
});
