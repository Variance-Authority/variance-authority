import { describe, expect, it } from 'vitest';
import { compareValues, fingerprintOfValueDelta } from './value.js';
import { shapeValue } from '../format/value.js';

/**
 * The claim under test is not *these two files differ*. A text diff says that,
 * correctly, for free.
 *
 * The claim is that one edit reads as one finding. Every assertion here is
 * therefore a **count** as much as a shape: a removed object is one delta and not
 * one per leaf, an insertion into a keyed array is one delta and not two
 * thousand, and the same edit in two places carries one fingerprint so one
 * decision settles both.
 */

const KEYED = { arrayKey: { '/rows': 'id' } };

/** `size` rows, each distinguishable, so a shift by one moves every field. */
function rows(size: number, from = 0): readonly { id: string; label: string }[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `r${index + from}`,
    label: `row ${index + from}`,
  }));
}

describe('a row inserted at the top of a long array', () => {
  const before = { rows: rows(2000) };
  const after = { rows: [{ id: 'new', label: 'row new' }, ...rows(2000)] };

  it('is two thousand rows having changed, compared by index', () => {
    const deltas = compareValues(shapeValue(before), shapeValue(after));

    // Every row shifted one place, so both members of all 2000 of them differ,
    // and index 2000 is a tail that did not exist. This is the failure the
    // medium has instead of forty red screenshots, and it is arithmetic rather
    // than a shortcoming of any particular differ.
    expect(deltas).toHaveLength(4001);
  });

  it('is one addition, compared by what identifies a row', () => {
    const deltas = compareValues(shapeValue(before, KEYED), shapeValue(after, KEYED));

    expect(deltas).toEqual([
      {
        change: 'added',
        pointer: '/rows/new',
        fingerprint: fingerprintOfValueDelta('json', '/rows/-', 'added', ['/rows']),
      },
    ]);
  });
});

describe('a delta lands on the root of what moved', () => {
  it('reports a removed subtree once, not once per leaf', () => {
    const deltas = compareValues(
      shapeValue({ keep: 1, gone: { a: { deep: true }, b: [1, 2, 3] } }),
      shapeValue({ keep: 1 }),
    );

    expect(deltas.map((delta) => delta.pointer)).toEqual(['/gone']);
    expect(deltas[0]!.change).toBe('removed');
  });

  it('reports a changed kind once and does not descend into it', () => {
    const deltas = compareValues(
      shapeValue({ tags: { a: 1, b: 2 } }),
      shapeValue({ tags: ['a', 'b'] }),
    );

    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ change: 'type-changed', pointer: '/tags' });
  });

  it('names the whole value when the whole value changed kind', () => {
    expect(compareValues(shapeValue([]), shapeValue({}))[0]).toMatchObject({ pointer: '' });
  });
});

describe('the same edit in two places is one shape', () => {
  it('carries one fingerprint across rows and across subjects', () => {
    const deltas = compareValues(
      shapeValue({ runs: [{ ms: 1 }, { ms: 2 }, { ms: 3 }] }),
      shapeValue({ runs: [{ ms: 9 }, { ms: 2 }, { ms: 8 }] }),
    );

    expect(deltas.map((delta) => delta.pointer)).toEqual(['/runs/0/ms', '/runs/2/ms']);
    expect(new Set(deltas.map((delta) => delta.fingerprint)).size).toBe(1);
  });

  it('does not carry the same fingerprint for a different kind of change', () => {
    expect(fingerprintOfValueDelta('json', '/a', 'added')).not.toBe(
      fingerprintOfValueDelta('json', '/a', 'removed'),
    );
  });

  it('groups the same edit made to two rows of a keyed array', () => {
    const rows = (label: string) => ({
      rows: [
        { id: 'a', label },
        { id: 'b', label },
      ],
    });
    const deltas = compareValues(shapeValue(rows('was'), KEYED), shapeValue(rows('now'), KEYED));

    expect(deltas.map((delta) => delta.pointer)).toEqual(['/rows/a/label', '/rows/b/label']);
    expect(new Set(deltas.map((delta) => delta.fingerprint)).size).toBe(1);
  });

  it('does not carry the same fingerprint across dialects', () => {
    expect(fingerprintOfValueDelta('json', '/a', 'added')).not.toBe(
      fingerprintOfValueDelta('route-table', '/a', 'added'),
    );
  });
});

describe('what the comparison refuses', () => {
  it('will not compare two dialects', () => {
    expect(() =>
      compareValues(shapeValue({}, { dialect: 'json' }), shapeValue({}, { dialect: 'graphql' })),
    ).toThrow(/cannot compare a json value against a graphql one/);
  });

  // A rules change and a subject change are both "the text is different", and
  // reporting the first as the second is a run telling somebody their API moved
  // because this package was upgraded.
  it('will not compare two recipes', () => {
    const baseline = { ...shapeValue({ a: 1 }), recipe: 'value/0' };

    expect(() => compareValues(baseline, shapeValue({ a: 1 }))).toThrow(
      /shaped under different rules/,
    );
  });
});

describe('a value the adopter declared volatile', () => {
  it('produces no delta when it moves', () => {
    const drop = ['/at'];
    const deltas = compareValues(
      shapeValue({ id: 1, at: 'monday' }, { drop }),
      shapeValue({ id: 1, at: 'friday' }, { drop }),
    );

    expect(deltas).toEqual([]);
  });

  it('produces a delta when the key it named goes away', () => {
    const drop = ['/at'];
    const deltas = compareValues(
      shapeValue({ id: 1, at: 'monday' }, { drop }),
      shapeValue({ id: 1 }, { drop }),
    );

    expect(deltas).toMatchObject([{ change: 'removed', pointer: '/at' }]);
  });
});
