import { describe, expect, it } from 'vitest';
import { decodeCaseTimes, encodeCaseTimes } from './case-times.js';

describe('a case\'s statement times as its row keeps them', () => {
  it('reads back each statement\'s time and what surrounded it, each figure absent where none was read', () => {
    const times = [
      { line: 3, time: 120, load: 1.5, rss: 300, free: 0, added: 30000 },
      { line: 4, time: 400, load: 1.5, rss: 310, free: 0 },
      { line: 2, time: 7 },
    ];

    expect(decodeCaseTimes(encodeCaseTimes(times))).toEqual(times);
  });

  it('refuses a row that says a fifth figure, or a level below zero', () => {
    // A row that read figures, line 3 in 5 µs, then digits past the four figures.
    expect(() => decodeCaseTimes(Uint8Array.from([0, 6, 5, 81]))).toThrow();
    // The load moved by −1 from 0.
    expect(() => decodeCaseTimes(Uint8Array.from([0, 6, 5, 2, 1]))).toThrow();
  });
});
