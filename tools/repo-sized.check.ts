import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE, unbounded } from './repo-sized.mjs';

/**
 * No list with one entry per file of the checkout in the JS heap.
 *
 * At ~400k files such a list is 400k strings before anything is done with
 * them, and it ends in an out-of-memory crash on the repositories this tool
 * is for. The list stays in Rust; JS receives an answer bounded by the
 * question — a top-N, a page, a count, one file, or a set the caller named.
 *
 * `repo-sized.mjs` finds every napi export that takes or returns a collection
 * and every place shipped TypeScript lists files itself (`ls-files`,
 * `ls-tree`, a glob, a recursive directory walk). Each passes when the comment
 * above it says what bounds it on a `bound:` line. What was unbounded when the
 * rule came in is held in the baseline, which only shrinks.
 *
 * ```bash
 * yarn repo-sized          # every crossing, bound or not
 * yarn repo-sized --write  # record the baseline after one was removed
 * ```
 */

interface Place {
  readonly at: string;
  readonly count: number;
}

describe('repo-sized lists in JS', () => {
  const now = unbounded() as readonly Place[];
  const before = JSON.parse(readFileSync(BASELINE, 'utf8')) as readonly Place[];
  const recorded = new Map(before.map((place) => [place.at, place.count]));
  const counts = new Map(now.map((place) => [place.at, place.count]));

  it('does not spread', () => {
    const grown = now
      .filter((place) => place.count > (recorded.get(place.at) ?? 0))
      .map((place) => `${place.at}: ${place.count} unbounded, ${recorded.get(place.at) ?? 0} recorded`);

    expect(
      grown.length === 0
        ? ''
        : `${grown.length} place(s) can hand JS a list as long as the checkout:\n\n  ${grown.join('\n  ')}\n\n` +
            'Do the per-file work in one native call that returns what the question needs — a top-N, a page, a count, ' +
            'or the set the caller named — and keep the full list in Rust. If the collection is bounded by something ' +
            'other than the checkout, say what on a `bound:` line in the comment above it. Never add to the baseline.',
    ).toBe('');
  });

  it('leaves the baseline no longer than what it records', () => {
    const closed = before
      .filter((place) => (counts.get(place.at) ?? 0) < place.count)
      .map((place) => `${place.at}: ${place.count} recorded, ${counts.get(place.at) ?? 0} now`);

    expect(
      closed.length === 0
        ? ''
        : `${closed.length} recorded place(s) are bounded or gone:\n\n  ${closed.join('\n  ')}\n\n` +
            'Tighten the ratchet with `yarn repo-sized --write`.',
    ).toBe('');
  });

  it('is read from a repository that was actually read', () => {
    expect(now.length + before.length).toBeGreaterThan(0);
  });
});
