import { describe, expect, it } from 'vitest';
import type { ComponentHash } from '@variance-authority/core';
import { observationsFrom, type Observation, type RunContext } from './observation.js';

/**
 * What a run is allowed to write down.
 *
 * Two properties are under test and they pull in opposite directions. A row must
 * be written whenever something moved — a change nothing recorded is a change
 * nobody can ask about again — and a row must *not* be written when nothing moved,
 * or every rate computed later is inflated by re-recording. The interesting cases
 * are the ones where "moved" depends on which tier is asking.
 */

const CHROMIUM_RUN: RunContext = {
  project: 'shop',
  subject: 'story:card',
  run: 'run-1',
  commit: 'c1',
  profile: 'chromium',
  at: '2026-01-01T00:00:00Z',
  accepted: true,
};

const JSDOM_RUN: RunContext = { ...CHROMIUM_RUN, profile: 'jsdom', run: 'run-2', commit: 'c2' };

function hashOf(component: string, digests: Partial<ComponentHash> = {}): ComponentHash {
  return {
    component,
    instances: 1,
    structure: 'v1:s',
    style: 'v1:t',
    geometry: 'v1:g',
    ...digests,
  };
}

/** As `hashComponents` returns it under a profile with no layout engine. */
function withoutGeometry(component: string): ComponentHash {
  return { component, instances: 1, structure: 'v1:s', style: 'v1:t' };
}

describe('shaping a run into rows', () => {
  it('writes one row per band the profile observed', () => {
    const rows = observationsFrom([hashOf('Button')], CHROMIUM_RUN);

    expect(rows.map((row) => row.band)).toEqual(['structure', 'style', 'geometry']);
  });

  it('writes no geometry row at all under a tier that cannot observe layout', () => {
    // Absent, never empty (ADR-0002). An empty geometry digest would compare equal
    // between a run that saw no movement and a run that could not see movement,
    // which is the false `unchanged` this system exists to refuse.
    const rows = observationsFrom([withoutGeometry('Button')], JSDOM_RUN);

    expect(rows.map((row) => row.band)).toEqual(['structure', 'style']);
  });

  it('records which tier observed every row, including the portable band', () => {
    // Structure compares across tiers, so carrying the profile looks redundant —
    // until somebody has to find out which tier wrote a row, after the fact, with
    // no way to derive it.
    const rows = observationsFrom([hashOf('Button')], CHROMIUM_RUN);

    expect(rows.every((row) => row.profile === 'chromium')).toBe(true);
  });

  it('records no pixel, coordinate, rect or count on any row', () => {
    // The measurement that killed the first version of this package: a 1px edit to
    // a spacing token produced 4949 changed pixels, because the count is dominated
    // by how much page sits below the edit. This test is the guard rail against it
    // returning as "just one more useful column".
    const [row] = observationsFrom([hashOf('Button')], { ...CHROMIUM_RUN, files: { Button: 'src/Button.tsx' } });

    expect(Object.keys(row!).sort()).toEqual([
      'accepted',
      'at',
      'band',
      'commit',
      'component',
      'file',
      'hash',
      'profile',
      'project',
      'run',
      'subject',
    ]);
  });

  it('writes nothing for a band whose hash has not moved', () => {
    const previous = observationsFrom([hashOf('Button')], CHROMIUM_RUN);
    const again = observationsFrom([hashOf('Button')], { ...CHROMIUM_RUN, run: 'run-9' }, previous);

    // Re-recording an unchanged hash costs a row per component per run and, worse,
    // makes every later rate read as "changed in every run".
    expect(again).toEqual([]);
  });

  it('writes the row for a component it has never seen, even though nothing moved', () => {
    const previous = observationsFrom([hashOf('Button')], CHROMIUM_RUN);
    const rows = observationsFrom([hashOf('Button'), hashOf('Badge')], CHROMIUM_RUN, previous);

    // A first sighting is a change from nothing. Skipping it would make "when did
    // this component arrive" unanswerable for every component that ever existed.
    expect(rows.map((row) => row.component)).toEqual(['Badge', 'Badge', 'Badge']);
  });

  it('compares structure against a previous row from any tier', () => {
    const underJsdom = observationsFrom([withoutGeometry('Button')], JSDOM_RUN);
    const rows = observationsFrom([hashOf('Button')], CHROMIUM_RUN, underJsdom);

    // Structure is portable (measured: 107/107 agree). Recording it once per tier
    // would double the structural churn rate of any project running both.
    expect(rows.map((row) => row.band)).toEqual(['style', 'geometry']);
  });

  it('writes a style row when the only previous style row came from another tier', () => {
    const underJsdom = observationsFrom([withoutGeometry('Button')], JSDOM_RUN);
    const rows = observationsFrom(
      [{ ...hashOf('Button'), style: 'v1:t' }],
      CHROMIUM_RUN,
      underJsdom,
    );

    // Identical digests across tiers here only because the fixture says so. Style
    // agrees across profiles on 0 of 107 real boundaries, so treating a jsdom style
    // row as the baseline for a chromium one would suppress a real change on the
    // rare occasion the two collide, and rewrite every component the rest of the time.
    expect(rows.some((row) => row.band === 'style')).toBe(true);
  });

  it('attaches a declaring file only for the components whose file is known', () => {
    const rows = observationsFrom([hashOf('Button'), hashOf('Badge')], {
      ...CHROMIUM_RUN,
      files: { Button: 'src/Button.tsx' },
    });

    // `resolveSource` reports an ambiguous name rather than picking a file; a row
    // that guessed would send an agent to edit the wrong one with full confidence.
    expect(rows.find((row) => row.component === 'Button')?.file).toBe('src/Button.tsx');
    expect(rows.find((row) => row.component === 'Badge')).not.toHaveProperty('file');
  });

  it('compares against the newest previous row when a bulk read hands back two', () => {
    // `current` returns the latest row per (component, band, profile), so
    // `structure` — the one band scoped without a profile — arrives twice on a
    // project that runs both tiers. Order between scopes is not promised, so the
    // instant decides. If the older row won, this run would record a change back
    // to a hash the project has already moved away from.
    const older: Observation = {
      project: 'shop',
      subject: 'story:card',
      component: 'Button',
      band: 'structure',
      hash: 'v1:s',
      profile: 'jsdom',
      commit: 'c0',
      run: 'run-0',
      at: '2026-01-01T00:00:00Z',
      accepted: true,
    };
    const newer: Observation = { ...older, hash: 'v1:s2', profile: 'chromium', at: '2026-02-01T00:00:00Z' };

    // Newest first and newest last, because arrival order must not decide it.
    for (const previous of [[newer, older], [older, newer]]) {
      const rows = observationsFrom([hashOf('Button', { structure: 'v1:s2' })], CHROMIUM_RUN, previous);
      expect(rows.some((row) => row.band === 'structure')).toBe(false);
    }
  });

  it('refuses previous rows belonging to another subject', () => {
    const foreign: Observation[] = [
      { ...(observationsFrom([hashOf('Button')], CHROMIUM_RUN)[0] as Observation), subject: 'story:other' },
    ];

    // A component's hash is scoped to the subject it was hashed in. A previous row
    // from elsewhere that happened to match would suppress a real change, and a
    // suppressed change is the one failure this system must never produce.
    expect(() => observationsFrom([hashOf('Button')], CHROMIUM_RUN, foreign)).toThrow(
      /must belong to shop\/story:card/,
    );
  });
});
