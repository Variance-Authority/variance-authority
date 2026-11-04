import { spellingOf } from '@variance-authority/mcp/tools';
import { describe, expect, it } from 'vitest';
import { outsideLine } from './uses-declarations.js';

describe('outsideLine', () => {
  it('asks a wire host, which holds no scan’s names, the discover question in the checkout', () => {
    expect(outsideLine('parseSync', ['oxc-parser'], spellingOf(undefined))).toBe(
      '`parseSync` is imported from `oxc-parser`, outside this workspace: `variance ask discover --imports oxc-parser#parseSync`, asked in the checkout, lists the files that import it.',
    );
  });

  it('says nothing when no source is named', () => {
    expect(outsideLine('parseSync', [], spellingOf({ shell: 'variance ask' }))).toBeUndefined();
  });
});
