import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FileRecord } from '@variance-authority/mcp/tools';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { search } from './search.js';

/**
 * What the loose pass may do, and the two things it may never do.
 *
 * It exists for the queries a substring cannot answer at all: a word typed
 * wrong, and two words written about a name but not written beside each other.
 * Everything else about it is a restriction — it may not reorder the answer, it
 * may not reach outside the area, and it may not print when it has nothing to
 * add — so most of what is asserted here is an absence.
 *
 * The fixture is the one next door, arranged so the two directions disagree.
 * `measure` is declared in `values.ts`, which `again.ts` reaches and
 * `inner/deeper.ts` does not.
 */

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/workspace');
const READING = readHelp(WORKSPACE);

const reads = (file: string, ...to: readonly string[]): FileRecord =>
  to.length === 0 ? { file } : { file, edges: to.map((target) => ({ to: target, kind: 'imports' as const })) };

const TREE = treeOf(
  [
    reads('packages/alpha/src/values.ts'),
    reads('packages/alpha/src/deep.ts'),
    reads('packages/alpha/src/index.ts', 'packages/alpha/src/values.ts'),
    reads('packages/beta/src/index.ts', 'packages/alpha/src/index.ts', 'packages/alpha/src/deep.ts'),
    reads('packages/beta/src/again.ts', 'packages/alpha/src/index.ts'),
    reads('packages/beta/src/inner/deeper.ts', 'packages/alpha/src/deep.ts'),
  ] satisfies readonly FileRecord[],
  WORKSPACE,
);

const ask = (args: Record<string, unknown>): string => search.run(READING, args, { tree: TREE });

describe('a name the substring cannot reach', () => {
  it('answers a word typed wrong, and says that is what it did', () => {
    const text = ask({ query: 'meesure' });
    expect(text).toContain('measure');
    expect(text).toContain('loosely');
    // The fact about the substring is still told, whole, above the offer.
    expect(text).toContain('Nothing in this repository is named or documented with `meesure`');
  });

  it('answers two words that are written apart', () => {
    // `Span` is documented *Two numbers, in order.* — which contains both words
    // and contains the query as text nowhere.
    const text = ask({ query: 'numbers order' });
    expect(text).toContain('Span');
    expect(text).toContain('loosely');
  });

  it('requires every word to land, so a two-word query is not the union', () => {
    expect(ask({ query: 'numbers unwritten' })).not.toContain('Span');
  });
});

describe('what it may never do', () => {
  it('prints nothing when the substring already answered', () => {
    const text = ask({ query: 'measure' });
    expect(text).toContain('measure');
    expect(text).not.toContain('loosely');
  });

  it('never offers a name back to whoever typed it', () => {
    // `behind` is a substring answer, so the wider net must not return it a
    // second time under a heading that says it is something else.
    const text = ask({ query: 'behind' });
    expect(text).toContain('behind [const]');
    expect(text).not.toContain('loosely');
  });

  it('stays inside the area rather than beside it', () => {
    // `inner/deeper.ts` reaches `deep.ts` and never `values.ts`, so the closure
    // rules `measure` out — and a widening must not be a way back in.
    expect(ask({ query: 'meesure', from: 'packages/beta/src/inner/deeper.ts' })).not.toContain('measure');
    expect(ask({ query: 'meesure', from: 'packages/beta/src/again.ts' })).toContain('measure');
  });

  it('leaves an empty answer empty when the wider net catches nothing either', () => {
    const text = ask({ query: 'zzz' });
    expect(text).toContain('Nothing in this repository is named or documented with `zzz`');
    expect(text).not.toContain('loosely');
  });
});
