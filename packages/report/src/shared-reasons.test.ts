import { describe, expect, it } from 'vitest';
import { byReason } from './shared-reasons.js';

/**
 * Subjects that share a verdict and a reason, folded into one group.
 *
 * Two readers print it — the pull-request docket and `variance_summary` — and
 * each had its own copy of the fold. Pinned here so the two cannot come to
 * disagree about what "the same reason" means.
 */

describe('byReason', () => {
  it('folds subjects with one label and one reason into a group, in the order first seen', () => {
    const groups = byReason([
      { label: 'incomparable', because: 'recipe moved', subject: 'a' },
      { label: 'new', because: 'no baseline', subject: 'b' },
      { label: 'incomparable', because: 'recipe moved', subject: 'c' },
    ]);

    expect(groups).toEqual([
      { label: 'incomparable', because: 'recipe moved', subjects: ['a', 'c'] },
      { label: 'new', because: 'no baseline', subjects: ['b'] },
    ]);
  });

  it('keeps one reason under two labels apart, since the labels ask for different actions', () => {
    const groups = byReason([
      { label: 'changed', because: 'same words', subject: 'a' },
      { label: 'drifted', because: 'same words', subject: 'b' },
    ]);

    expect(groups.map((group) => group.label)).toEqual(['changed', 'drifted']);
  });
});
