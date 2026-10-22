import { describe, expect, it } from 'vitest';
import { READS_ATTRIBUTE, reads } from './index.js';

describe('what an element says it showed', () => {
  it('names each file once, in code-unit order, on the attribute a page run reads', () => {
    expect(reads('docs/b.md', ['docs/a.md', 'docs/b.md'], 'docs/B.md')).toEqual({
      [READS_ATTRIBUTE]: 'docs/B.md docs/a.md docs/b.md',
    });
  });

  it('spreads nothing when it was handed nothing to name', () => {
    // Absent, not empty: an element that showed no file carries no claim.
    expect(reads()).toEqual({});
    expect(reads(undefined, [undefined])).toEqual({});
  });

  it('refuses a path the attribute could not carry', () => {
    // The attribute is space-separated, so a path holding a space would come
    // back as two files nobody showed.
    expect(() => reads('docs/a b.md')).toThrow(/docs\/a b\.md/);
    expect(() => reads('')).toThrow(/empty/);
  });
});
