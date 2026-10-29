import { describe, expect, it } from 'vitest';
import { unverified } from './gate.mjs';

/**
 * The push gate asks about the commits git pushes, not the checkout: each
 * pushed sha's tree must carry both waves. A deletion and a tag are not asked.
 */
describe('unverified', () => {
  const trees: Record<string, string> = { a1: 'ta', b2: 'tb', c3: 'tc' };
  const stamped: Record<string, string[]> = { ta: ['near', 'rules'], tb: ['near'] };
  const check = (input: string) =>
    unverified(input, (sha: string) => trees[sha], (tree: string) => stamped[tree] ?? []).map(
      ({ ref, missing }: { ref: string; missing: string[] }) => [ref, missing],
    );

  it('passes a commit whose tree carries both waves', () => {
    expect(check('refs/heads/x a1 refs/heads/x 0000')).toEqual([]);
  });

  it('refuses each pushed commit by its own tree, whatever is checked out', () => {
    expect(check('refs/heads/x a1 refs/heads/x 0000\nrefs/heads/y b2 refs/heads/f 0000\nrefs/heads/z c3 refs/heads/z 0000')).toEqual([
      ['refs/heads/y', ['rules']],
      ['refs/heads/z', ['near', 'rules']],
    ]);
  });

  it('does not ask about a deletion or a tag', () => {
    expect(check('(delete) 0000000 refs/heads/x a1\nrefs/tags/v1 c3 refs/tags/v1 0000\n')).toEqual([]);
  });
});
