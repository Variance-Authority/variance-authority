import { describe, expect, it } from 'vitest';
import { EMPTY, Translation } from './set-translation.js';

describe('the difference of two output sets', () => {
  it('holds the cases of the first that the second does not, and none of a set less itself', () => {
    const sets = new Translation(8);
    const three = sets.of([5, 1, 3]);
    const one = sets.of([3]);

    expect([...sets.members(sets.minus(three, one))]).toEqual([1, 5]);
    expect(sets.minus(three, three)).toBe(EMPTY);
    expect([sets.minus(three, EMPTY), sets.minus(EMPTY, three)]).toEqual([three, EMPTY]);
  });
});
