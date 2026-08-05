import { describe, expect, it } from 'vitest';
import { progress, record, startTrail, summarizeTrail } from './trail.js';
import { normalize } from '../rules/normalize/index.js';
import { CHROMIUM_PROFILE, capture, node } from '../rules/normalize/fixture.js';
import type { SemanticSnapshot } from '../format/snapshot.js';

/**
 * The four questions an author loop asks that a pair of observations cannot.
 *
 * Every test here is about a *trajectory*: an edit that was reverted, a state
 * that has been reached before, a component broken two edits ago and fixed since.
 * A version of this suite that only checked "the last edit moved `Button`" would
 * pass against a comparison of two snapshots, which already exists — so each test
 * is paired with the reason a two-element comparison gets it wrong.
 */

/** A page whose two components can each be edited independently. */
function page(button: string, badge: string): SemanticSnapshot {
  return normalize(
    capture({
      profile: CHROMIUM_PROFILE,
      subjectId: 'story:page',
      root: node({
        owners: [{ name: 'Shell', props: {} }],
        rect: { x: 0, y: 0, width: 200, height: 60 },
        rules: [{ selector: '.shell', declare: { display: 'block' } }],
        children: [
          node({
            tag: 'button',
            text: button,
            owners: [{ name: 'Button', props: {} }, { name: 'Shell', props: {} }],
            rect: { x: 0, y: 0, width: 80, height: 20 },
          }),
          node({
            tag: 'span',
            text: badge,
            owners: [{ name: 'Badge', props: {} }, { name: 'Shell', props: {} }],
            rect: { x: 0, y: 24, width: 40, height: 16 },
          }),
        ],
      }),
    }),
  );
}

const trailOf = (...states: readonly SemanticSnapshot[]) =>
  states.reduce((trail, snapshot) => record(trail, snapshot), startTrail('story:page'));

describe('what the last edit did', () => {
  it('names only what moved in the last step', () => {
    const state = progress(trailOf(page('Save', 'New'), page('Submit', 'New'), page('Submit', 'Old')))!;

    expect(state.sinceLast).toEqual(['Badge']);
  });
});

describe('what the session has changed', () => {
  it('is the difference from the start, not the sum of the steps', () => {
    // The failure a per-step comparison cannot avoid. `Button` was edited and
    // then put back; the step that changed it and the step that reverted it both
    // report it, and adding them up says two things changed. Nothing did.
    const state = progress(trailOf(page('Save', 'New'), page('Submit', 'New'), page('Save', 'New')))!;

    expect(state.changed).toEqual([]);
    expect(state.sinceLast).toEqual(['Button']);
  });

  it('says the subject is exactly as it was found', () => {
    const state = progress(trailOf(page('Save', 'New'), page('Submit', 'New'), page('Save', 'New')))!;

    expect(state.atStart).toBe(true);
    expect(summarizeTrail(trailOf(page('Save', 'New'), page('Submit', 'New'), page('Save', 'New'))))
      .toContain('exactly as this session found it');
  });

  it('still reports a component that is genuinely different', () => {
    // The control. A rule that reported "nothing changed" whenever any component
    // had been reverted would be worse than no rule at all.
    const state = progress(trailOf(page('Save', 'New'), page('Submit', 'New'), page('Save', 'Old')))!;

    expect(state.changed).toEqual(['Badge']);
    expect(state.atStart).toBe(false);
  });
});

describe('what an edit put back', () => {
  it('names a component that moved away from the start and returned', () => {
    // The question that decides whether to keep going. `Button` was broken at
    // step 1 and fixed at step 2; `Badge` is still broken. An agent reading only
    // the last step sees `Button` move and cannot tell it moved *back*.
    const state = progress(
      trailOf(page('Save', 'New'), page('Submit', 'Old'), page('Save', 'Old')),
    )!;

    expect(state.repaired).toEqual(['Button']);
    expect(state.changed).toEqual(['Badge']);
  });

  it('does not call a component repaired that was never broken', () => {
    const state = progress(trailOf(page('Save', 'New'), page('Save', 'Old'), page('Save', 'Old')))!;

    expect(state.repaired).toEqual([]);
  });
});

describe('going in circles', () => {
  it('names the earlier step this state repeats', () => {
    // Two edits that cancel. Every pairwise comparison in the trail reports a
    // difference, and the agent is exactly where it was three steps ago — which
    // only the whole history can say.
    const trail = trailOf(
      page('Save', 'New'),
      page('Submit', 'New'),
      page('Submit', 'Old'),
      page('Submit', 'New'),
    );

    expect(progress(trail)!.returnedTo).toBe(1);
    expect(summarizeTrail(trail)).toContain('identical to step 1');
  });

  it('says nothing about circles on a trail that has not repeated', () => {
    const trail = trailOf(page('Save', 'New'), page('Submit', 'New'), page('Submit', 'Old'));

    expect(progress(trail)!.returnedTo).toBeUndefined();
    expect(summarizeTrail(trail)).not.toContain('identical to step');
  });
});

describe('what a trail refuses', () => {
  it('will not answer before there is an edit to answer about', () => {
    // One observation is a starting state. Reporting "nothing changed" for it
    // would be a claim about an edit nobody has made.
    expect(progress(trailOf(page('Save', 'New')))).toBeNull();
    expect(progress(startTrail('story:page'))).toBeNull();
  });

  it('will not record a different subject', () => {
    const other = normalize(
      capture({ profile: CHROMIUM_PROFILE, subjectId: 'story:other', root: node({}) }),
    );

    expect(() => record(startTrail('story:page'), other)).toThrow(/refusing to record/);
  });

  it('carries the author’s own label without matching on it', () => {
    const trail = record(startTrail('story:page'), page('Save', 'New'), 'baseline');

    expect(trail.steps[0]!.label).toBe('baseline');
  });
});
