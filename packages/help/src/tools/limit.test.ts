import { describe, expect, it } from 'vitest';
import type { Help } from '@variance-authority/package/help';
import { discover } from './discover.js';
import { grep } from './grep.js';
import { intersectionOf } from './intersection.js';
import { uses } from './uses.js';

/**
 * Every listing question reads `limit` through the one reading `mcp` owns, and
 * refuses one it cannot read before it reads anything else, rather than
 * answering with the default.
 */

describe('limit', () => {
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
