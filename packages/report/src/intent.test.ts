import { describe, expect, it } from 'vitest';
import type { ComponentRecord } from './composition.js';
import type { ObservationRecord, RegionRecord, RunReport } from './format.js';
import { adjudicateRun, describeAdjudication, parseRoot } from './intent.js';

/**
 * Reading a run back against what its author said they were doing.
 *
 * The arm under test is the third one. Two tools in this category can tell an
 * agent that something moved; none of them can tell it that the edit it just
 * made **did not happen**, and the difference between "rendered and held still"
 * and "never rendered" is the difference between going back to the edit and going
 * back to the subject list. So the cases here are mostly about which of those two
 * sentences comes out, and about the ways a claim could quietly be graded against
 * evidence the run never had.
 */

const BRAND = 'v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SPACING = 'v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function region(overrides: Partial<RegionRecord> = {}): RegionRecord {
  return { x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true, ...overrides };
}

function changed(subject: string, regions: readonly RegionRecord[]): ObservationRecord {
  return { subject, verdict: 'changed', because: 'moved', changedPixels: 100, regions };
}

function component(name: string, subjects: readonly string[]): ComponentRecord {
  return { component: name, subjects, instances: subjects.length, examples: [] };
}

function report(
  observations: readonly ObservationRecord[],
  components?: readonly ComponentRecord[],
): RunReport {
  return {
    runVersion: 1,
    at: '2026-08-20T10:00:00.000Z',
    identity: {
      renderer: 'playwright-chromium',
      engine: 'chromium@131.0.0',
      platform: 'darwin/arm64',
      deviceScaleFactor: 1,
      fonts: [],
    },
    retention: 'ephemeral',
    observations,
    ...(components === undefined
      ? {}
      : {
          composition: {
            subjects: [...new Set(components.flatMap((record) => record.subjects))],
            components,
            echoes: [],
            divergences: [],
            movements: [],
          },
        }),
  };
}

describe('a claim that matched nothing', () => {
  const nothing = [changed('story:card', [region({ fingerprint: SPACING, component: 'Card' })])];

  it('says the edit did not take when the run rendered the component and it held still', () => {
    const [outcome] = adjudicateRun(report(nothing, [component('Button', ['story:a', 'story:b'])]), [
      { root: 'component:Button', reason: 'new accent' },
    ]).claims;

    expect(outcome?.verdict).toBe('undelivered');
    expect(outcome?.because).toContain('rendered in 2 subject(s)');
    expect(outcome?.because).toContain('The edit did not take');
  });

  it('refuses to say it when the run never rendered the component', () => {
    const [outcome] = adjudicateRun(report(nothing, [component('Card', ['story:card'])]), [
      { root: 'component:Button', reason: 'new accent' },
    ]).claims;

    // Same absence of evidence, opposite instruction. Grading this as a failed
    // edit would send an agent back to a file that was never rendered.
    expect(outcome?.verdict).toBe('unobservable');
    expect(outcome?.because).toContain('never rendered');
  });

  it('refuses to say it when the run kept no census at all', () => {
    const [outcome] = adjudicateRun(report(nothing), [
      { root: 'component:Button', reason: 'new accent' },
    ]).claims;

    expect(outcome?.verdict).toBe('unobservable');
    expect(outcome?.because).toContain('kept no component census');
  });

  it('is always the strong reading for a shape, which nothing else could produce', () => {
    const [outcome] = adjudicateRun(report(nothing), [
      { root: `shape:${BRAND}`, reason: 'the accent difference' },
    ]).claims;

    expect(outcome?.verdict).toBe('undelivered');
    expect(outcome?.because).toContain('nothing produced that difference');
  });
});

describe('a claim that matched', () => {
  const brand = [
    changed('story:a', [region({ fingerprint: BRAND, component: 'Button' })]),
    changed('story:b', [region({ fingerprint: BRAND, component: 'Button' })]),
  ];

  it('is delivered within its declared bound', () => {
    const result = adjudicateRun(report(brand, [component('Button', ['story:a', 'story:b'])]), [
      { root: 'component:Button', reason: 'new accent', maxSubjects: 2 },
    ]);

    expect(result.claims[0]).toMatchObject({ verdict: 'delivered', subjects: ['story:a', 'story:b'] });
    expect(result.verdict).toBe('clean');
  });

  it('over-reaches past it, and stays the intended change', () => {
    const [outcome] = adjudicateRun(report(brand), [
      { root: 'component:Button', reason: 'new accent', maxSubjects: 1 },
    ]).claims;

    expect(outcome?.verdict).toBe('overreached');
    expect(outcome?.because).toContain('reached 2 subject(s) against the 1 declared');
  });

  it('does not authorize the component whose name it is a prefix of', () => {
    const [outcome] = adjudicateRun(
      report([changed('story:group', [region({ fingerprint: BRAND, component: 'ButtonGroup' })])], [
        component('Button', ['story:a']),
      ]),
      [{ root: 'Button', reason: 'new accent' }],
    ).claims;

    expect(outcome?.verdict).toBe('undelivered');
  });

  it('names the fields this resolution could not check rather than dropping them', () => {
    const [outcome] = adjudicateRun(
      report(brand),
      [{ root: 'component:Button', reason: 'new accent' }],
      { unchecked: ['bands'] },
    ).claims;

    expect(outcome?.because).toContain('Not checked here: bands.');
  });
});

describe('what the run did that nobody claimed', () => {
  it('reports it separately, and over-claiming to avoid it costs the other arm', () => {
    const observations = [
      changed('story:a', [region({ fingerprint: BRAND, component: 'Button' })]),
      changed('story:b', [region({ fingerprint: SPACING, component: 'Card' })]),
    ];
    const census = [
      component('Button', ['story:a']),
      component('Card', ['story:b']),
      component('Tooltip', ['story:a', 'story:b']),
    ];

    const narrow = adjudicateRun(report(observations, census), [
      { root: 'component:Button', reason: 'new accent' },
    ]);
    expect(narrow.unclaimed.map((entry) => entry.change.component)).toEqual(['Card']);
    expect(narrow.verdict).toBe('review');

    // The same agent claiming everything so nothing can be unclaimed. `Tooltip`
    // rendered in both subjects and held still, so the claim that covers nothing
    // is reported rather than absorbed — and it outranks the collateral it was
    // meant to hide.
    const greedy = adjudicateRun(report(observations, census), [
      { root: 'component:Button', reason: 'new accent' },
      { root: 'component:Card', reason: 'new accent' },
      { root: 'component:Tooltip', reason: 'new accent' },
    ]);
    expect(greedy.unclaimed).toEqual([]);
    expect(greedy.verdict).toBe('unmet');
  });

  it('never counts a changed subject with no shape as collateral', () => {
    const result = adjudicateRun(report([changed('story:opaque', [region({})])]), []);

    // No document behind the comparison means no claim could have been checked
    // against it. Calling that unclaimed would invent collateral out of a gap.
    expect(result.unclaimed).toEqual([]);
    expect(result.ungrouped).toEqual(['story:opaque']);
  });
});

describe('the sentence an agent reads first', () => {
  it('leads with the edit that did not take, ahead of everything else', () => {
    const text = describeAdjudication(
      adjudicateRun(
        report([changed('story:b', [region({ fingerprint: SPACING, component: 'Card' })])], [
          component('Button', ['story:a']),
        ]),
        [{ root: 'component:Button', reason: 'new accent' }],
      ),
    );

    expect(text.startsWith('An edit you declared did not take.')).toBe(true);
    expect(text.indexOf('[undelivered]')).toBeLessThan(text.indexOf('[unclaimed]'));
  });

  it('bounds every line by what the run failed to look at', () => {
    const base = report([], [component('Button', ['story:a'])]);
    const text = describeAdjudication(
      adjudicateRun(
        { ...base, notObserved: [{ subject: 'story:c', kind: 'error', because: 'timed out' }] },
        [],
      ),
    );

    expect(text).toContain('1 subject(s) were not looked at');
  });
});

describe('what a claim is about', () => {
  it('reads a bare name as a component and a prefix as what it says', () => {
    expect(parseRoot('Button')).toEqual({ kind: 'component', name: 'Button' });
    expect(parseRoot('component:Button')).toEqual({ kind: 'component', name: 'Button' });
    expect(parseRoot(`shape:${BRAND}`)).toEqual({ kind: 'shape', name: BRAND });
  });

  it('keeps a name that carries a colon of its own rather than eating it', () => {
    expect(parseRoot('story:card--populated')).toEqual({
      kind: 'component',
      name: 'story:card--populated',
    });
  });
});
