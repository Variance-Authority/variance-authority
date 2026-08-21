import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE, silent } from './documented.mjs';

/**
 * Documentation, checked where it is read rather than where it is written.
 *
 * Not a coverage rule. A rule that demanded a block comment on every export
 * would be satisfied by a repository full of one-line restatements of the name,
 * and it would demand one for the several hundred names nothing outside their own
 * package imports — which are documented by their call sites and by the file they
 * sit in.
 *
 * The subject here is narrower and is the one an adopter meets: a name that
 * **crosses a package boundary** and says nothing. Somebody else's file imports
 * it, so somebody else has to guess what it does, and the guess is made in a
 * different package from the answer.
 *
 * It is a ratchet rather than a floor. The baseline records what is silent
 * today; a name that goes quiet is a line in a review, and a name that gains a
 * paragraph tightens the baseline by one. Neither direction passes silently,
 * because a ratchet that only fails one way stops being read.
 *
 * ```bash
 * yarn documented --write
 * ```
 *
 * The baseline records the file and not the line. A line number moves whenever
 * anything above it does, and a baseline that churned on every edit would be
 * re-recorded without being read, which is the failure mode of every ledger.
 */

interface Silent {
  readonly name: string;
  readonly kind: string;
  readonly at: string;
  readonly packages: number;
}

const recorded = (): readonly Silent[] => JSON.parse(readFileSync(BASELINE, 'utf8')) as Silent[];

const key = (entry: Silent): string => `${entry.name} [${entry.kind}] ${entry.at}`;

describe('names other packages import', () => {
  const found = silent() as readonly Silent[];
  const before = new Set(recorded().map(key));
  const now = new Set(found.map(key));

  it('gain no new silence', () => {
    const added = found.filter((entry) => !before.has(key(entry)));
    const report = added
      .map((entry) => `  ${key(entry)} — imported by ${entry.packages} packages`)
      .join('\n');

    expect(
      added.length === 0
        ? ''
        : `${added.length} name(s) now cross a package boundary with nothing written above them:\n\n` +
            `${report}\n\n` +
            'Write the block comment where the name is declared. If the name is not meant to be ' +
            'reached from another package, the fix is the `exports` map rather than a paragraph. ' +
            'Record a deliberate one with `yarn documented --write`.',
    ).toBe('');
  });

  it('leave the baseline no longer than the silence it records', () => {
    // The tightening half. A name that gained a paragraph and stayed on the list
    // makes the list a description of last month, and a list nobody trusts is a
    // list nobody reads before adding to it.
    const closed = [...before].filter((entry) => !now.has(entry));

    expect(
      closed.length === 0
        ? ''
        : `${closed.length} recorded name(s) are documented now:\n\n  ${closed.join('\n  ')}\n\n` +
            'Tighten the ratchet with `yarn documented --write`.',
    ).toBe('');
  });

  it('are read from a workspace that was actually read', () => {
    // A reader that fails by returning less would empty this list, and an empty
    // list re-recorded is a check that agrees with a bug forever.
    expect(found.length + recorded().length).toBeGreaterThan(0);
  });
});
