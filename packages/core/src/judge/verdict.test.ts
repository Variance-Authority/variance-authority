import { describe, expect, it } from 'vitest';
import { UNOBSERVED, blocks, severityOf, type BandOutcome, type Verdict } from './verdict.js';

/**
 * The verdict model, held to the two positions it is here to state.
 *
 * This file's exports are the policy layer's vocabulary and the run loop uses
 * none of them — `@variance-authority/report` carries the verdicts a run
 * actually produces, and [`metrics.md`](../../../../docs/metrics.md) records M8,
 * intent and adjudication, as not taken. What the layer being unconsumed does not
 * excuse is being unasserted: `core/judge/index.ts` calls `UNOBSERVED` "the
 * group's whole argument in one export", and until now nothing anywhere held it
 * to that.
 */

const EVERY: readonly Verdict[] = [
  'unchanged',
  'inherited',
  'authorized',
  'needs-review',
  'violation',
  'unexplained',
];

describe('unobserved is not a pass, and cannot be spelled like one', () => {
  it('is outside the verdict ordering entirely', () => {
    // The claim the barrel makes. A band nobody could observe has no severity,
    // because it has no finding — `severityOf` cannot be asked about it, and
    // `-1` from an `indexOf` would be a *lower* severity than `unchanged`.
    expect(EVERY.map(severityOf)).not.toContain(-1);
    expect(EVERY as readonly string[]).not.toContain(UNOBSERVED);

    // Only `BandOutcome` widens to admit it, and it stays a separate word there.
    const outcome: BandOutcome = UNOBSERVED;
    expect(outcome).toBe('unobserved');
  });

  it('orders severity as a total order with no ties', () => {
    const ranks = EVERY.map(severityOf);
    expect(new Set(ranks).size).toBe(EVERY.length);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('ranks an unexplained difference above a forbidden one', () => {
    // Inverted relative to every pixel-diff tool, and it is the project's
    // position rather than a scale: residue the pipeline cannot explain means
    // provenance failed, so the tool has lost the thread rather than found a
    // small problem.
    expect(severityOf('unexplained')).toBeGreaterThan(severityOf('violation'));
    expect(severityOf('unexplained')).toBe(EVERY.length - 1);
  });
});

describe('what fails CI', () => {
  it('blocks exactly the three that need somebody', () => {
    expect(EVERY.filter(blocks)).toEqual(['needs-review', 'violation', 'unexplained']);
  });

  it('blocks every verdict above the last approving one', () => {
    // The invariant behind the list, so a seventh verdict inserted in the middle
    // cannot arrive non-blocking and pass this file unchanged.
    const lowest = Math.min(...EVERY.filter(blocks).map(severityOf));
    expect(EVERY.filter((verdict) => severityOf(verdict) >= lowest).every(blocks)).toBe(true);
  });
});
