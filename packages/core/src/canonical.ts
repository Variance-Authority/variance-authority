/**
 * Canonical serialization.
 *
 * Determinism (Principle 2) means byte-identical output for identical inputs, on
 * any machine. `JSON.stringify` does not provide that: key order follows
 * insertion order, and float formatting is the one place where "obvious" and
 * "identical everywhere" diverge.
 *
 * Everything hashed by this system passes through `canonicalize` first.
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue | undefined };

/**
 * Serialize to a canonical string: object keys sorted by code unit, `undefined`
 * members omitted (never emitted as `null`), and numbers formatted per
 * {@link canonicalNumber}.
 *
 * Omitting rather than nulling `undefined` is what makes "a dimension this
 * profile cannot observe" structurally absent from the hash input rather than
 * present-and-empty (ADR-0002). Absence and emptiness must not collide.
 *
 * @throws {RangeError} on `NaN` or `Infinity` — a non-finite value in a hash
 * input means an upstream measurement failed, and silently encoding it would
 * produce a stable hash for a broken observation.
 */
export function canonicalize(value: CanonicalValue): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return canonicalNumber(value);
    case 'string':
      return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  const record = value as { readonly [key: string]: CanonicalValue | undefined };
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const member = record[key];
    if (member === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalize(member)}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * Format a number identically across platforms.
 *
 * `-0` normalizes to `0`: it is a legitimate output of layout arithmetic and is
 * indistinguishable from `0` to every consumer, but stringifies differently.
 * Integers are emitted without a decimal point; other values keep full round-trip
 * precision, having already been rounded to their dimension's tolerance by the
 * ruleset (lengths to px at fixed precision) before reaching here.
 */
export function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`canonical serialization requires a finite number, received ${value}`);
  }
  if (Object.is(value, -0)) return '0';
  return String(value);
}
