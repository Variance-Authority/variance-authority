import { describe, expect, it } from 'vitest';
import { memoryParseCache, type Parsed } from './cache.js';
const a = 'git:1111111111111111111111111111111111111111';
const BUTTON: Parsed = { requests: [{ value: './button.css', kind: 'imports', bindings: [], line: 3 }], declares: ['Button'] };
describe('the in-memory cache', () => {
  it('answers with what was parsed from those bytes', () => {
    const cache = memoryParseCache();

    expect(cache.get(a)).toBeUndefined();
    cache.set(a, BUTTON);
    expect(cache.get(a)).toEqual(BUTTON);
  });
});
