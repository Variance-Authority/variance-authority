import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FileRecord, Tree } from '@variance-authority/mcp/tools';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { search } from './search.js';

/**
 * A start point is the only thing that scales a substring.
 *
 * The tree is built out of file records — the scanner's own unit — rather than
 * scanned off the fixture, for the reason the tree tests next door give: the
 * scope is a fact about the import graph, and a fixture that had to resolve
 * `alpha` through a `dist` nobody built would be testing the resolver. The
 * coordinates are the fixture's real files and the edges are its real imports,
 * so what is asserted is the rule and not the walk.
 *
 * The two directions are arranged to disagree. `again.ts` reaches `values.ts`
 * and never `deep.ts`; `inner/deeper.ts` reaches `deep.ts` and never
 * `values.ts`. A scope that were a ranking, or a path prefix over
 * `packages/alpha/`, would pass a test whose answers overlapped — so none of
 * these overlap.
 */

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/workspace');
const READING = readHelp(WORKSPACE);

const reads = (file: string, ...to: readonly string[]): FileRecord =>
  to.length === 0 ? { file } : { file, edges: to.map((target) => ({ to: target, kind: 'imports' as const })) };

const SOURCE: readonly FileRecord[] = [
  reads('packages/alpha/src/values.ts'),
  reads('packages/alpha/src/deep.ts'),
  reads('packages/alpha/src/index.ts', 'packages/alpha/src/values.ts'),
  reads('packages/beta/src/index.ts', 'packages/alpha/src/index.ts', 'packages/alpha/src/deep.ts'),
  reads('packages/beta/src/again.ts', 'packages/alpha/src/index.ts'),
  reads('packages/beta/src/inner/deeper.ts', 'packages/alpha/src/deep.ts'),
];

const TREE = treeOf(SOURCE, WORKSPACE);

/** Distinguishes *no tree was read* from *this test did not say*, which a default argument cannot. */
const NONE = Symbol('no tree');

function ask(args: Record<string, unknown>, walked: Tree | typeof NONE = TREE): string {
  return search.run(READING, args, walked === NONE ? {} : { tree: walked });
}

describe('a start point', () => {
  it('answers with the names in reach and not the ones out of it', () => {
    const text = ask({ query: 'e', from: 'packages/beta/src/again.ts' });
    expect(text).toContain('measure');
    // `behind` is one import away from beta's own index, and nothing `again.ts`
    // imports reaches it. A prefix rule over `packages/alpha/` would let it
    // through, which is exactly the rule this is not.
    expect(text).not.toContain('behind');
  });

  it('walks the imports rather than the folder', () => {
    const text = ask({ query: 'e', from: 'packages/beta/src/inner/deeper.ts' });
    expect(text).toContain('behind');
    expect(text).not.toContain('measure');
  });

  it('answers the other direction with what reaches the destination', () => {
    const text = ask({ query: 'e', to: 'packages/alpha/src/deep.ts' });
    expect(text).toContain('deeper');
    expect(text).not.toContain('measure');
  });

  it('unions the two directions rather than intersecting them', () => {
    // Two entry points of one application share almost no file, so an
    // intersection would answer nothing about a question that named two places.
    const text = ask({
      query: 'e',
      from: 'packages/beta/src/again.ts',
      to: 'packages/alpha/src/deep.ts',
    });
    expect(text).toContain('measure');
    expect(text).toContain('deeper');
  });

  it('says where it looked, so a count can be placed', () => {
    expect(ask({ query: 'e', from: 'packages/beta/src/again.ts' })).toContain(
      'reachable from `packages/beta/src/again.ts`',
    );
  });

  it('asks nothing of the tree when no start point was said', () => {
    expect(search.wants?.({ query: 'e' })).toBe(false);
    expect(search.wants?.({ query: 'e', from: 'packages/beta/src/again.ts' })).toBe(true);
    // An empty string is nothing said, not a path that failed.
    expect(search.wants?.({ query: 'e', from: '' })).toBe(false);
  });

  it('refuses a path the tree does not hold rather than widening to everything', () => {
    const text = ask({ query: 'measure', from: 'packages/gamma/' });
    expect(text).toContain('not found');
    // The refusal is the whole answer. A name that plainly matches must not
    // appear under it, or the caller reads the unscoped answer as the scoped one.
    expect(text).not.toContain('alpha ·');
  });

  it('refuses a start point when no tree was read', () => {
    const text = ask({ query: 'measure', from: 'packages/beta/src/again.ts' }, NONE);
    expect(text).toContain('no source tree was read');
    expect(text).not.toContain('alpha ·');
  });

  it('says an empty area is a fact about the area', () => {
    const text = ask({ query: 'zzz', from: 'packages/beta/src/again.ts' });
    expect(text).toContain('a fact about the area, not about the word');
  });

  it('is unchanged when nothing was said', () => {
    const text = ask({ query: 'measure' }, NONE);
    expect(text).toContain('measure');
    expect(text).not.toContain('along the imports');
  });
});
