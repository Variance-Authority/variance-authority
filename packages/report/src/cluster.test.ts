import { describe, expect, it } from 'vitest';
import { clusterChanges, describeClustering } from './cluster.js';
import type { ObservationRecord, RegionRecord } from './format.js';

/**
 * Grouping a run into the decisions it actually contains.
 *
 * What is asserted is not that a `groupBy` groups. It is the four properties
 * that decide whether a reviewer can trust a bulk action: that a shape appearing
 * beside something else is **not** offered as a one-action decision, that a
 * shape carrying no component is not silently promoted to one that does, that
 * ungrouped subjects stay visible instead of collapsing into a catch-all, and
 * that the ordering is total so two readings of one report agree.
 */

function region(overrides: Partial<RegionRecord> = {}): RegionRecord {
  return {
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    pixels: 100,
    cause: true,
    ...overrides,
  };
}

function changed(subject: string, regions: readonly RegionRecord[]): ObservationRecord {
  return { subject, verdict: 'changed', because: 'moved', changedPixels: 100, regions };
}

const BRAND = 'v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SPACING = 'v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('one edit across many subjects is one decision', () => {
  it('groups by shape and ranks by how much one action would finish', () => {
    const { changes } = clusterChanges([
      changed('story:a', [region({ fingerprint: BRAND, component: 'Button', file: 'src/Button.tsx' })]),
      changed('story:b', [region({ fingerprint: BRAND, component: 'Button' })]),
      changed('story:c', [region({ fingerprint: BRAND, component: 'Button' })]),
      changed('story:d', [region({ fingerprint: SPACING, component: 'Card' })]),
    ]);

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      fingerprint: BRAND,
      component: 'Button',
      file: 'src/Button.tsx',
      subjects: ['story:a', 'story:b', 'story:c'],
      settles: ['story:a', 'story:b', 'story:c'],
      pixels: 300,
    });
    expect(changes[1]?.fingerprint).toBe(SPACING);
  });

  it('says how many subjects and how many decisions, which are different numbers', () => {
    const clustering = clusterChanges([
      changed('story:a', [region({ fingerprint: BRAND })]),
      changed('story:b', [region({ fingerprint: BRAND })]),
      changed('story:c', [region({ fingerprint: SPACING })]),
    ]);

    // The whole point of the module in one sentence: a workload becomes a plan.
    expect(describeClustering(clustering, 3)).toBe(
      '3 subject(s) changed, and they are 2 distinct change(s) — 2 of which can be decided in one action',
    );
  });
});

describe('what a bulk decision is not allowed to reach', () => {
  it('does not offer to settle a subject where something else also moved', () => {
    const [brand] = clusterChanges([
      changed('story:clean', [region({ fingerprint: BRAND })]),
      changed('story:mixed', [region({ fingerprint: BRAND }), region({ fingerprint: SPACING })]),
    ]).changes;

    // Present in both, safe to decide in one of them. Accepting the shape in
    // `story:mixed` would promote the spacing change nobody looked at, which is
    // how a bulk-accept feature turns a gate into a recorder.
    expect(brand?.subjects).toEqual(['story:clean', 'story:mixed']);
    expect(brand?.settles).toEqual(['story:clean']);
  });

  it('does not settle a subject that also changed somewhere it could not name', () => {
    const [brand] = clusterChanges([
      changed('story:partial', [region({ fingerprint: BRAND }), region({})]),
    ]).changes;

    // A region with no fingerprint is a difference we could not group. Counting
    // it as covered would claim a shape explains something nobody identified.
    expect(brand?.settles).toEqual([]);
  });

  it('leaves a change with no component visibly without one', () => {
    const [pixelOnly] = clusterChanges([
      changed('story:a', [region({ fingerprint: BRAND })]),
      changed('story:b', [region({ fingerprint: BRAND, component: 'Button' })]),
    ]).changes;

    // Taken from the first region that has one, and the *absence* survives when
    // none does. A pixel fingerprint carries no cause, and a group formed by
    // silhouette alone is the weaker claim — it must not borrow a component
    // from a neighbour and start looking like the stronger one.
    expect(pixelOnly?.component).toBe('Button');
    expect(clusterChanges([changed('story:a', [region({ fingerprint: BRAND })])]).changes[0])
      .not.toHaveProperty('component');
  });
});

describe('what is not grouped stays visible', () => {
  it('counts subjects with no fingerprint anywhere rather than inventing a change', () => {
    const clustering = clusterChanges([
      changed('story:a', [region({ fingerprint: BRAND })]),
      changed('story:ephemeral', [region({}), region({})]),
    ]);

    // The ephemeral mode compares without a document, so its regions carry no
    // shape. Bundling those into one cluster would report a "change" that is
    // really the absence of one.
    expect(clustering.ungrouped).toEqual(['story:ephemeral']);
    expect(clustering.changes).toHaveLength(1);
    expect(describeClustering(clustering, 2)).toContain('1 could not be grouped');
  });

  it('ignores the verdicts that are not awaiting a decision', () => {
    const clustering = clusterChanges([
      { subject: 'story:same', verdict: 'unchanged', because: '', changedPixels: 0, regions: [] },
      {
        subject: 'story:absorbed',
        verdict: 'ignored',
        because: '',
        changedPixels: 0,
        regions: [region({ fingerprint: BRAND })],
      },
      { subject: 'story:first', verdict: 'new', because: '', changedPixels: 0, regions: [] },
    ]);

    // `ignored` is green and its difference is a decision already made. Listing
    // it as a change awaiting one would ask the operator to re-decide every rule
    // they have ever written, every run.
    expect(clustering).toEqual({ changes: [], ungrouped: [] });
    expect(describeClustering(clustering, 0)).toBe('nothing changed');
  });
});

describe('an ordering two readings agree on', () => {
  it('breaks every tie, so the docket does not wobble between runs', () => {
    const observations = [
      changed('story:a', [region({ fingerprint: SPACING, pixels: 50 })]),
      changed('story:b', [region({ fingerprint: BRAND, pixels: 50 })]),
    ];

    // Equal settles, equal subjects, equal pixels — resolved by the digest, so
    // reversing the input cannot reorder the output. A docket whose ordering
    // wobbles is one nobody can diff.
    const forward = clusterChanges(observations).changes.map((change) => change.fingerprint);
    const backward = clusterChanges([...observations].reverse()).changes.map(
      (change) => change.fingerprint,
    );

    expect(forward).toEqual([BRAND, SPACING]);
    expect(backward).toEqual(forward);
  });
});
