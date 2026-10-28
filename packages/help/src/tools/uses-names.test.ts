import { describe, expect, it } from 'vitest';
import { spellingOf } from '@variance-authority/mcp/tools';
import type { Outside } from './indexed-imports.js';
import { importsUnread, outsideAfter, outsideAlone } from './uses-names.js';

/**
 * What the answer on a name declared outside the workspace says it could not
 * read: the files whose imports did not read, the first three named and the
 * rest counted, and, when the imports from outside are the whole answer, the
 * members by the name the source index did not read.
 */

const shown = { limit: 5, spell: spellingOf(undefined) };

const outside = (notRead: readonly string[]): Outside => ({
  sites: [{ at: 'src/a.ts', line: 1, by: '@t/w, from thirdp', kind: 'source', type: false, name: 'parseSync' }],
  packages: ['thirdp'],
  modules: [],
  notRead,
});

describe('importsUnread', () => {
  it('names three files whose imports did not read and counts the rest', () => {
    expect(importsUnread(outside(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']))).toEqual([
      'The imports of 5 files were not read, so an import of it there from outside the workspace is not known: a.ts, b.ts, c.ts and 2 more.',
    ]);
  });

  it('names all of three without counting', () => {
    expect(importsUnread(outside(['a.ts', 'b.ts', 'c.ts']))).toEqual([
      'The imports of 3 files were not read, so an import of it there from outside the workspace is not known: a.ts, b.ts, c.ts.',
    ]);
  });
});

describe('outsideAlone and outsideAfter', () => {
  it('ends an answer of imports from outside alone with the members by the name that were not read', () => {
    const lines = outsideAlone('parseSync', outside([]), undefined, shown, { declarations: [], members: 'the index did not read' });
    expect(lines.at(-1)).toBe('Members by this name were not read: the index did not read.');
  });

  it('leaves the members to the workspace answer when the imports from outside follow one', () => {
    const lines = outsideAfter('parseSync', outside([]), undefined, shown, true);
    expect(lines.join('\n')).not.toContain('Members by this name');
  });
});
