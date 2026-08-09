import { describe, expect, it } from 'vitest';
import { createAbsentStore } from './absent.js';
import { isKept, type Churn, type HistoryStore, type Journey, type Reach } from './store.js';

/**
 * The store that keeps nothing.
 *
 * The property under test is a distinction, not a behaviour: an absent history
 * and an empty history must never produce the same answer. Everything about the
 * optional backend rests on it — an agent handed "0 changes in 0 runs" concludes
 * the product is stable, and what actually happened is that nobody kept a record.
 *
 * The comparison store below is deliberately a real, empty one. Testing the
 * absent store on its own would prove only that it says something; the claim is
 * that it says something *different*.
 */

/** A store that is genuinely keeping a record, which so far contains nothing. */
function emptyStore(): HistoryStore {
  const churn: Churn = {
    component: 'Button',
    window: {},
    runs: 0,
    changedRuns: 0,
    bands: [],
    collateralRuns: 0,
    rejectedRuns: 0,
    omittedRuns: 0,
    omittedObservations: 0,
  };
  const journey: Journey = { token: '--brand', window: {}, values: [], omitted: 0 };
  const reach: Reach = {
    component: 'Button',
    window: {},
    subjects: [],
    arrived: [],
    omittedSubjects: 0,
  };

  return {
    async record(): Promise<void> {},
    async current() {
      return [];
    },
    async lastChanged() {
      return null;
    },
    async churn() {
      return churn;
    },
    async flakiness() {
      return {
        subject: 'story:card',
        window: {},
        runs: 0,
        sweeps: 0,
        occurrences: 0,
        absorbedRuns: 0,
        sweepsSince: 0,
        causes: [],
        omittedRuns: 0,
        omittedOccurrences: 0,
      };
    },
    async valueJourney() {
      return journey;
    },
    async reach() {
      return reach;
    },
  };
}

describe('the absent store', () => {
  it('answers every history question with the statement that none is kept', async () => {
    const store = createAbsentStore();

    const answers = [
      await store.current(['story:card']),
      await store.lastChanged('story:card', 'Button'),
      await store.churn('Button', {}),
      await store.flakiness('story:card', {}),
      await store.valueJourney('--brand', {}),
      await store.reach('Button', {}),
    ];

    // Not one of them may be an empty result. An empty result is an answer to a
    // question that was never asked.
    for (const answer of answers) {
      expect(isKept(answer)).toBe(false);
      expect(isKept(answer) ? '' : answer.because).toContain('no history store is configured');
    }
  });

  it('is distinguishable from a store that is keeping an empty record', async () => {
    const empty = await emptyStore().churn('Button', {});
    const absent = await createAbsentStore().churn('Button', {});

    // The whole point. Same call, same shape of caller, two different facts.
    expect(isKept(empty)).toBe(true);
    expect(isKept(absent)).toBe(false);
  });

  it('names the missing store instead of reporting that nothing has drifted', async () => {
    const answer = await createAbsentStore().valueJourney('--va-space-3', {});

    expect(isKept(answer) ? '' : answer.because).toContain(
      'not a finding that nothing has drifted',
    );
    expect(isKept(answer) ? '' : answer.because).toContain('what `--va-space-3` has drifted to');
  });

  it('phrases the refusal around the question that was asked', async () => {
    const store = createAbsentStore();

    // A single generic sentence would be rendered next to a component name and
    // read as being about that component's stability.
    const withBand = await store.lastChanged('story:card', 'Button', 'geometry');
    expect(isKept(withBand) ? '' : withBand.because).toContain('in its geometry band');
  });

  it('refuses the read a run makes before it writes, rather than answering "nothing yet"', async () => {
    // The one refusal with teeth. An empty array is a *valid* previous set —
    // "nothing recorded yet" — so a caller that failed to narrow the answer would
    // compute a full set of rows and hand them to a `record` that discards them.
    // Nothing wrong, nothing kept, and nobody finds it for a cycle.
    const empty = await emptyStore().current(['a', 'b']);
    const absent = await createAbsentStore().current(['a', 'b']);

    expect(isKept(empty)).toBe(true);
    expect(isKept(absent)).toBe(false);
    expect(isKept(absent) ? '' : absent.because).toContain('these 2 subjects');
  });

  it('accepts a write and discards it, so a run without a backend still finishes', async () => {
    // Refusing here would make an unconfigured store a crash in the middle of a
    // run that is otherwise entirely fine, and the first fix anybody reaches for
    // is a catch that swallows it back into an empty result.
    await expect(
      createAbsentStore().record(
        { project: 'shop', run: 'r1', commit: 'c1', profile: 'jsdom', at: '2026-01-01T00:00:00Z' },
        [],
        [],
      ),
    ).resolves.toBeUndefined();
  });
});
