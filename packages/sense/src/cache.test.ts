import { describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import { memoryParseCache, type Parsed } from './cache.js';

/** A cache keyed by content cannot go stale: it answers with what those bytes parsed to. */

const BUTTON: Parsed = {
  requests: [{ value: './button.css', kind: 'imports', bindings: [], line: 3 }],
  declares: ['Button'],
};

const a: Digest = 'git:1111111111111111111111111111111111111111';

describe('the in-memory cache', () => {
  it('answers with what was parsed from those bytes', () => {
    const cache = memoryParseCache();

    expect(cache.get(a)).toBeUndefined();
    cache.set(a, BUTTON);
    expect(cache.get(a)).toEqual(BUTTON);
  });
});
