import { describe, expect, it } from 'vitest';
import { affectedSubjects, indexOf } from './affected.js';

/**
 * What an edit could not possibly have changed.
 *
 * Every test here is about the *asymmetry*. Observing a subject that did not need
 * it costs a collection; skipping one that did produces a green run over an
 * unwatched surface — silently, because the subject is not in the report to be
 * missing from. So the interesting cases are all the ones where the answer is
 * unknown, and the assertion is always that unknown resolves to *observe*.
 */

const SOURCE = indexOf(
  new Map([
    ['src/ds/Button.tsx', 'export function Button() { return null }'],
    ['src/ds/Clock.tsx', 'export const Clock = () => null'],
  ]),
);

const ROOTS = ['src'];

function baselines(
  entries: readonly (readonly [string, readonly string[] | undefined])[],
): ReadonlyMap<string, readonly string[] | undefined> {
  return new Map(entries);
}

describe('choosing what to observe from a diff', () => {
  it('observes the subjects whose baseline records a component the diff touched', () => {
    const answer = affectedSubjects({
      planned: ['story:button', 'story:clock'],
      changed: ['src/ds/Button.tsx'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([
        ['story:button', ['Button', 'Text']],
        ['story:clock', ['Clock']],
      ]),
    });

    expect(answer.observe).toEqual(['story:button']);
    expect(answer.skipped.map((entry) => entry.subject)).toEqual(['story:clock']);
    expect(answer.whole).toBeUndefined();
    // The skip carries its own reason, because a subject absent from a report is
    // a subject nobody can ask about.
    expect(answer.skipped[0]?.because).toContain('touched none of them');
  });

  it('observes a subject that has no baseline, because nothing is known about it', () => {
    const answer = affectedSubjects({
      planned: ['story:new'],
      changed: ['src/ds/Button.tsx'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([['story:new', undefined]]),
    });

    expect(answer.observe).toEqual(['story:new']);
    expect(answer.skipped).toEqual([]);
  });

  it('observes a subject whose baseline predates the component list', () => {
    // Absent is unknown, never "renders nothing". A selector that read a missing
    // field as an empty list would skip every subject in a suite whose baselines
    // were written before ADR-0027.
    const answer = affectedSubjects({
      planned: ['story:old'],
      changed: ['src/ds/Button.tsx'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([['story:old', undefined]]),
    });

    expect(answer.observe).toEqual(['story:old']);
  });

  it('runs everything when a changed file under the roots declares no component', () => {
    // A stylesheet, a token file, a helper every component imports. None of them
    // names itself in any subject's component list, and all of them can move
    // every subject in the suite.
    const answer = affectedSubjects({
      planned: ['story:button', 'story:clock'],
      changed: ['src/ds/tokens.css'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([
        ['story:button', ['Button']],
        ['story:clock', ['Clock']],
      ]),
    });

    expect(answer.observe).toEqual(['story:button', 'story:clock']);
    expect(answer.whole).toContain('declare no component');
    expect(answer.because).toContain('every subject was observed');
  });

  it('ignores a change outside the scanned roots rather than widening to everything', () => {
    // Otherwise every diff that touched a README would force a whole run, and the
    // operator would conclude selection does not work rather than that their
    // roots are narrow.
    const answer = affectedSubjects({
      planned: ['story:button', 'story:clock'],
      changed: ['README.md', 'src/ds/Button.tsx'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([
        ['story:button', ['Button']],
        ['story:clock', ['Clock']],
      ]),
    });

    expect(answer.observe).toEqual(['story:button']);
  });

  it('runs everything when nothing changed inside the roots at all', () => {
    // Distinct from "nothing was affected". The diff says nothing about
    // components either way, and answering it with an empty selection would
    // report a clean suite that looked at none of itself.
    const answer = affectedSubjects({
      planned: ['story:button'],
      changed: ['README.md'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([['story:button', ['Button']]]),
    });

    expect(answer.observe).toEqual(['story:button']);
    expect(answer.whole).toContain('none of the 1 changed file(s) is under the scanned roots');
  });

  it('runs everything when the diff named nothing', () => {
    const answer = affectedSubjects({
      planned: ['story:button'],
      changed: [],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([['story:button', ['Button']]]),
    });

    expect(answer.observe).toEqual(['story:button']);
    expect(answer.whole).toContain('named no changed file');
  });

  it('matches a root on a directory boundary, not on a prefix of characters', () => {
    // `src` claiming `srcery/` would force whole runs forever, and the reason
    // would be invisible.
    const answer = affectedSubjects({
      planned: ['story:button'],
      changed: ['srcery/theme.css'],
      source: SOURCE,
      roots: ROOTS,
      baselines: baselines([['story:button', ['Button']]]),
    });

    expect(answer.whole).toContain('under the scanned roots');
    expect(answer.whole).not.toContain('declare no component');
  });
});
