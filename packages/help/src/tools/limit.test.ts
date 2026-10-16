import { describe, expect, it } from 'vitest';
import type { Help } from '@variance-authority/package/help';
import { discover } from './discover.js';
import { grep } from './grep.js';
import { intersectionOf } from './intersection.js';
import { limitOf, notShown } from './limit.js';
import { uses } from './uses.js';

/**
 * Every listing question reads `limit` one way, and refuses one it cannot read
 * before it reads anything else, rather than answering with the default.
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

  it('is refused by uses, grep, discover and intersection before they read anything', () => {
    const asked = [
      () => uses.run(undefined as unknown as Help, { name: 'anything', limit: 0 }, undefined),
      () => grep.run(undefined, { query: 'anything', limit: 0 }, undefined),
      () => discover.run(undefined, { imports: ['a#b'], declares: 'c', limit: 0 }, undefined),
      () => intersectionOf([]).run(undefined, { questions: [], limit: 0 }, undefined),
    ];
    for (const ask of asked) expect(ask).toThrow(/takes a whole number of rows/);
  });
});
