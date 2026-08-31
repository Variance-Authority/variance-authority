import { describe, expect, it } from 'vitest';
import { unenteredSubjects } from './journey.js';

/**
 * The second ground, and the one asymmetry that governs every case here.
 *
 * A subject skipped in error is a green run over an unwatched surface, and it is
 * silent, because the subject is not in the report to be missing from. A subject
 * observed unnecessarily costs one collection. So the assertions are almost all
 * about the ways this must *decline* to narrow: an empty answer from the journal
 * has two readings, and only one of them is a licence to skip anything.
 */

const PLANNED = ['story:cart-card--item', 'story:cart-card--removing', 'story:cart-card--verbose'];

describe('what the recorded journeys rule out', () => {
  it('skips a subject the journal recorded whole and the diff never reached', () => {
    // The case no reading of the file could produce. All three subjects contain
    // `CartCard` and all three are made of the same components; one of them
    // clicked, and that is the whole difference.
    const { skipped } = unenteredSubjects({
      planned: PLANNED,
      whole: PLANNED,
      entered: ['story:cart-card--removing'],
    });

    expect(skipped.map((entry) => entry.subject)).toEqual([
      'story:cart-card--item',
      'story:cart-card--verbose',
    ]);
    expect(skipped[0]?.because).toContain('this diff changed none of them');
  });

  it('observes a subject the journal has no whole record of', () => {
    // It was never painted with probes in the build, or it is new. Both are
    // *unknown*, and the journal has nothing to say about either.
    const { skipped, because } = unenteredSubjects({
      planned: PLANNED,
      whole: ['story:cart-card--removing'],
      entered: ['story:cart-card--removing'],
    });

    expect(skipped).toEqual([]);
    expect(because).toContain('2 of them it has no whole record of');
  });

  it('narrows nothing when the journal is whole about none of these subjects, and says so', () => {
    // `entered: []` is the trap. Read as *the diff reached nobody* it skips the
    // entire suite and reports success; read as *the journal recorded nobody* it
    // is a build with no probes in it. Same empty list, opposite facts.
    const { skipped, whole } = unenteredSubjects({
      planned: PLANNED,
      whole: ['story:main-nav--empty'],
      entered: [],
    });

    expect(skipped).toEqual([]);
    expect(whole).toContain('no whole observation of any subject in this run');
  });

  it('does not answer for a subject outside the plan', () => {
    // The journal outlives a run. A story deleted since it was recorded is not a
    // subject this run can skip, and counting it would inflate the tally the run
    // prints about work it avoided.
    const { skipped, because } = unenteredSubjects({
      planned: ['story:cart-card--item'],
      whole: [...PLANNED, 'story:main-nav--empty'],
      entered: ['story:cart-card--removing'],
    });

    expect(skipped.map((entry) => entry.subject)).toEqual(['story:cart-card--item']);
    expect(because).toContain('out of 1 subject the journal recorded whole');
  });

  it('says nothing was ruled out when the diff reached every recorded subject', () => {
    const { skipped, whole, because } = unenteredSubjects({
      planned: PLANNED,
      whole: PLANNED,
      entered: PLANNED,
    });

    expect(skipped).toEqual([]);
    // Not a refusal: the journal answered, and the answer was *all of them*.
    expect(whole).toBeUndefined();
    expect(because).toContain('0 subjects entered none of the changed code');
  });
});
