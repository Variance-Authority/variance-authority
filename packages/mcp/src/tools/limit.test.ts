import { describe, expect, it } from 'vitest';
import { limitOf, notShown } from './limit.js';

/**
 * Every listing question reads `limit` one way, and refuses one it cannot read
 * rather than answering with the default.
 */

const BAD = [0, -1, 2.5, 'many', ''] as const;

describe('limit', () => {
  it('is the default when not said, a number from the wire, or digits from the shell', () => {
    expect(limitOf({}, 12)).toBe(12);
    expect(limitOf({ limit: 3 }, 12)).toBe(3);
    expect(limitOf({ limit: '7' }, 12)).toBe(7);
  });

  it('refuses anything but a whole number of at least 1', () => {
    for (const limit of BAD) expect(() => limitOf({ limit }, 12)).toThrow(/takes a whole number of rows/);
  });

  it('says the rows it left out the same way everywhere', () => {
    expect(notShown(3)).toBe('3 more not shown; a higher `limit` shows them.');
  });
});
