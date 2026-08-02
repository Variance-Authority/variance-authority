import { describe, expect, it } from 'vitest';
import { canonicalize, canonicalNumber } from './canonical.js';
import { digestValue } from './hash.js';
import { propsDigest } from './provenance.js';

describe('canonicalize', () => {
  it('orders keys independently of insertion order', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('orders keys at every depth', () => {
    const one = { outer: { z: [{ b: 1, a: 2 }] } };
    const two = { outer: { z: [{ a: 2, b: 1 }] } };
    expect(canonicalize(one)).toBe(canonicalize(two));
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it('omits undefined members rather than emitting null', () => {
    // ADR-0002: absence must be structural, so an unobservable dimension never
    // collides with an observed-and-empty one.
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalize({ a: 1, b: null })).not.toBe(canonicalize({ a: 1, b: undefined }));
  });

  it('does not confuse a string with the number that prints the same', () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: '1' }));
  });

  it('rejects non-finite numbers instead of hashing a failed measurement', () => {
    expect(() => canonicalize({ width: Number.NaN })).toThrow(RangeError);
    expect(() => canonicalize({ width: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('normalizes negative zero, a routine product of layout arithmetic', () => {
    expect(canonicalNumber(-0)).toBe('0');
    expect(canonicalize({ x: -0 })).toBe(canonicalize({ x: 0 }));
  });
});

describe('digestValue', () => {
  it('is stable across runs', () => {
    expect(digestValue({ a: [1, 'two', true, null] })).toBe(
      digestValue({ a: [1, 'two', true, null] }),
    );
  });

  it('is prefixed so an algorithm change is greppable', () => {
    expect(digestValue({})).toMatch(/^v1:[0-9a-f]{32}$/);
  });
});

describe('propsDigest', () => {
  it('ignores the identity churn of a re-created inline closure', () => {
    // The over-invalidation half of spec §11.2: a fresh arrow every render must
    // not report every subject as changed on every build.
    expect(propsDigest({ onClick: () => {} })).toBe(propsDigest({ onClick: () => {} }));
  });

  it('distinguishes named handlers', () => {
    function handleSave(): void {}
    function handleDelete(): void {}
    expect(propsDigest({ onClick: handleSave })).not.toBe(propsDigest({ onClick: handleDelete }));
  });

  it('is insensitive to prop declaration order', () => {
    expect(propsDigest({ size: 'lg', tone: 'primary' })).toBe(
      propsDigest({ tone: 'primary', size: 'lg' }),
    );
  });

  it('separates an explicit undefined from an absent prop', () => {
    expect(propsDigest({ tone: undefined })).not.toBe(propsDigest({}));
  });

  it('digests a React element by type, not identity', () => {
    const element = (type: unknown) => ({
      $$typeof: Symbol.for('react.transitional.element'),
      type,
      props: {},
    });
    const Icon = function Icon(): null { return null; };
    const Avatar = function Avatar(): null { return null; };

    expect(propsDigest({ slot: element(Icon) })).toBe(propsDigest({ slot: element(Icon) }));
    expect(propsDigest({ slot: element(Icon) })).not.toBe(propsDigest({ slot: element(Avatar) }));
  });

  it('terminates on a cyclic prop graph', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node['self'] = node;
    expect(() => propsDigest({ node })).not.toThrow();
  });

  it('treats a repeated sibling reference as shared, not cyclic', () => {
    // The cycle guard must unwind on exit, or two references to one object
    // would digest differently depending on traversal order.
    const shared = { tone: 'primary' };
    expect(propsDigest({ a: shared, b: shared })).toBe(
      propsDigest({ a: { tone: 'primary' }, b: { tone: 'primary' } }),
    );
  });
});
