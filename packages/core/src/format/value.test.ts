import { describe, expect, it } from 'vitest';
import { DROPPED, shapeValue, pointerShape } from './value.js';

/**
 * The claim under test is not *this serializes*. `JSON.stringify` serializes.
 *
 * The claim is that two readings of an unchanged system produce one digest, and
 * that everything a reading cannot promise is either declared by the adopter or
 * refused by name. So the refusals are asserted on their *message*: a pointer in
 * the sentence is the difference between a fixable capture and a mystery.
 */

const ROWS = [
  { id: 'b', label: 'second' },
  { id: 'a', label: 'first' },
];

describe('a shaped value is addressed by what it says', () => {
  it('does not move when keys arrive in a different order', () => {
    const left = shapeValue({ alpha: 1, beta: { x: true, y: null } });
    const right = shapeValue({ beta: { y: null, x: true }, alpha: 1 });

    expect(right.digest).toBe(left.digest);
    expect(right.text).toBe(left.text);
  });

  it('carries the recipe it was produced under', () => {
    expect(shapeValue({}).recipe).toBe('value/1');
  });

  it('defaults its dialect to json and takes one when offered', () => {
    expect(shapeValue({}).dialect).toBe('json');
    expect(shapeValue({}, { dialect: 'route-table' }).dialect).toBe('route-table');
  });
});

describe('what an adopter declares volatile', () => {
  const clock = { id: 7, capturedAt: '2026-01-01T00:00:00Z' };

  it('is present in the text and cannot move the digest', () => {
    const drop = ['/capturedAt'];
    const first = shapeValue(clock, { drop });
    const later = shapeValue({ ...clock, capturedAt: '2026-08-21T12:00:00Z' }, { drop });

    expect(first.digest).toBe(later.digest);
    expect(first.text).toContain(DROPPED);
  });

  // The distinction the sentinel exists for. A dropped key rendered as an
  // absent one would make *I chose not to look* and *it is gone* the same text,
  // and the second is the finding this whole medium exists to report.
  it('is not the same text as a key that is gone', () => {
    const dropped = shapeValue(clock, { drop: ['/capturedAt'] });
    const gone = shapeValue({ id: 7 });

    expect(dropped.text).not.toBe(gone.text);
  });

  it('takes a token the adopter chose', () => {
    expect(shapeValue(clock, { replace: { '/capturedAt': '<when>' } }).text).toContain('<when>');
  });

  it('reaches every index through a wildcard, and one through an index', () => {
    const runs = { runs: [{ ms: 11 }, { ms: 900 }] };
    const every = shapeValue(runs, { drop: ['/runs/-/ms'] });
    const first = shapeValue(runs, { drop: ['/runs/0/ms'] });

    expect(every.text).toBe('{"runs":[{"ms":"[dropped]"},{"ms":"[dropped]"}]}');
    expect(first.text).toBe('{"runs":[{"ms":"[dropped]"},{"ms":900}]}');
  });

  // A shaped pointer cannot tell an array index from an object key spelled in
  // digits, and does not try: `{counts: {'2026': 5}}` wildcards the same way an
  // array would. That is a deliberate over-grouping — two years of the same
  // counter are the same kind of thing happening — and it is stated here rather
  // than discovered by somebody reading a fingerprint they did not expect.
  it('wildcards an index, and a key spelled like one with it', () => {
    expect(pointerShape('/rows/12/at')).toBe('/rows/-/at');
    expect(pointerShape('/counts/2026')).toBe('/counts/-');
  });
});

describe('an array with a key is not an array', () => {
  it('stops caring what order the rows arrived in', () => {
    const arrayKey = { '/rows': 'id' };
    const asRead = shapeValue({ rows: ROWS }, { arrayKey });
    const reversed = shapeValue({ rows: [...ROWS].reverse() }, { arrayKey });

    expect(reversed.digest).toBe(asRead.digest);
  });

  it('is still an array when no key is declared', () => {
    const asRead = shapeValue({ rows: ROWS });
    const reversed = shapeValue({ rows: [...ROWS].reverse() });

    expect(reversed.digest).not.toBe(asRead.digest);
  });

  it('refuses a key that does not identify a row', () => {
    expect(() =>
      shapeValue({ rows: [{ id: 'a' }, { id: 'a' }] }, { arrayKey: { '/rows': 'id' } }),
    ).toThrow(/two rows with `id` of a/);
  });

  it('refuses a row that has no key at all', () => {
    expect(() => shapeValue({ rows: [{}] }, { arrayKey: { '/rows': 'id' } })).toThrow(
      /\/rows\/0 has no `id`/,
    );
  });
});

describe('what cannot be a value is refused by name', () => {
  it('names the pointer of a non-finite number', () => {
    expect(() => shapeValue({ ratio: { of: Number.NaN } })).toThrow(/at \/ratio\/of is NaN/);
  });

  it('names the pointer of something that is not data', () => {
    expect(() => shapeValue({ handlers: [() => 1] })).toThrow(
      /at \/handlers\/0 is a function/,
    );
  });

  it('names the pointer of a date, which serializes to nothing', () => {
    // `typeof` says object, `Object.entries` says empty, and the text says `{}`.
    // Two different instants would have addressed to the same digest and compared
    // as unchanged.
    expect(() => shapeValue({ at: new Date(0) })).toThrow(/at \/at is a Date/);
    expect(() => shapeValue({ a: { b: [{ at: new Date(0) }] } })).toThrow(
      /at \/a\/b\/0\/at is a Date/,
    );
  });

  it('refuses the other containers whose state is not in their keys', () => {
    expect(() => shapeValue({ seen: new Set([1]) })).toThrow(/at \/seen is a Set/);
    expect(() => shapeValue({ by: new Map([['a', 1]]) })).toThrow(/at \/by is a Map/);
    expect(() => shapeValue({ at: new URL('https://example.com') })).toThrow(/at \/at is a URL/);
  });

  it('keeps an empty object and an instance that carries its own fields', () => {
    class Row {
      constructor(readonly id: string) {}
    }
    expect(shapeValue({ empty: {}, row: new Row('a') }).text).toBe(
      '{"empty":{},"row":{"id":"a"}}',
    );
  });

  it('escapes a key that contains a pointer separator', () => {
    expect(() => shapeValue({ 'a/b': Number.POSITIVE_INFINITY })).toThrow(
      /at \/a~1b is Infinity/,
    );
  });
});
