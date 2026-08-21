import { describe, expect, it } from 'vitest';
import { compareInterfaces } from './compare.js';
import type { InterfaceDocument, InterfaceField, InterfaceType } from './document.js';
import { digestValue } from '../format/hash.js';

/**
 * The claim under test is not *this changed*. A text diff makes that claim, and
 * makes it correctly, for free.
 *
 * The claim is that the **same** edit is safe on one side of a call and fatal on
 * the other. So every assertion here is written as a pair or a shared type: the
 * added member string is asserted equal across the two cases, because a suite
 * that only showed a red result and a green result would pass for a rule that
 * read the member's spelling instead of its position.
 */

function enumType(members: readonly string[]): InterfaceType {
  return { shape: 'enum', members, digest: digestValue([...members]) };
}

function field(path: string, type: string, over: Partial<InterfaceField> = {}): InterfaceField {
  return { path, type, required: true, nullable: false, ...over };
}

function doc(
  operations: InterfaceDocument['operations'],
  types: InterfaceDocument['types'] = {},
): InterfaceDocument {
  return { dialect: 'graphql', operations, types };
}

/** The one member added in both directions, so neither case can key on its text. */
const ADDED = 'ARCHIVED';

const HELD = ['DRAFT', 'PUBLISHED'] as const;

describe('an enum gaining a member', () => {
  const grow = (position: 'request' | 'response') => {
    const reach = [field('status', 'Status')];
    const other: InterfaceField[] = [];
    const operation = {
      id: 'posts',
      request: position === 'request' ? reach : other,
      response: position === 'response' ? reach : other,
    };
    return [
      doc([operation], { Status: enumType([...HELD]) }),
      doc([operation], { Status: enumType([...HELD, ADDED]) }),
    ] as const;
  };

  it('is a capability where the callee accepts it', () => {
    const [before, after] = grow('request');

    expect(compareInterfaces(before, after)).toEqual([
      {
        change: 'enum-member-added',
        at: { kind: 'type', type: 'Status', member: ADDED },
        positions: ['request'],
        band: 'capability',
      },
    ]);
  });

  it('is a broken contract where the callee returns it', () => {
    const [before, after] = grow('response');

    // The same string, in the same type, with the same digest arithmetic. The
    // only difference between this delta and the one above is which list the
    // field was in — which is the entire reason this module exists.
    expect(compareInterfaces(before, after)).toEqual([
      {
        change: 'enum-member-added',
        at: { kind: 'type', type: 'Status', member: ADDED },
        positions: ['response'],
        band: 'contract',
      },
    ]);
  });

  it('is one delta at the loudest reach when both sides use the enum', () => {
    const operations = [
      { id: 'setStatus', request: [field('status', 'Status')], response: [] },
      { id: 'post', request: [], response: [field('status', 'Status')] },
    ];
    const deltas = compareInterfaces(
      doc(operations, { Status: enumType([...HELD]) }),
      doc(operations, { Status: enumType([...HELD, ADDED]) }),
    );

    // One finding, not two: a reviewer is asked about the enum once. And
    // `contract`, not `capability` — a caller only has to break on one side to
    // break, so the loudest reaching position decides.
    expect(deltas).toEqual([
      {
        change: 'enum-member-added',
        at: { kind: 'type', type: 'Status', member: ADDED },
        positions: ['request', 'response'],
        band: 'contract',
      },
    ]);
  });
});

describe('requiredness inverts across the call', () => {
  const bandOf = (position: 'request' | 'response') => {
    const before = [field('note', 'String', { required: false })];
    const after = [field('note', 'String', { required: true })];
    const at = (fields: readonly InterfaceField[]) =>
      doc([
        {
          id: 'submit',
          request: position === 'request' ? fields : [],
          response: position === 'response' ? fields : [],
        },
      ]);

    const deltas = compareInterfaces(at(before), at(after));
    expect(deltas).toHaveLength(1);
    return deltas[0]!.band;
  };

  it('breaks a caller that must now send a field it never sent', () => {
    expect(bandOf('request')).toBe('contract');
  });

  it('breaks nobody when the callee merely promises more', () => {
    expect(bandOf('response')).toBe('capability');
  });
});

describe('a type many operations reach', () => {
  it('is reported once, named as the type', () => {
    const money = (over: Partial<InterfaceField> = {}) => [
      field('total', 'Money', { owner: 'Order' }),
      field('total.amount', 'Int', { owner: 'Money' }),
      field('total.currency', 'String', { owner: 'Money', ...over }),
    ];
    const build = (fields: readonly InterfaceField[]) =>
      doc(
        ['order', 'cart', 'invoice', 'refund'].map((id) => ({
          id,
          request: [],
          response: [...fields],
        })),
      );

    const deltas = compareInterfaces(
      build(money()),
      build(money().slice(0, 2)),
    );

    // Four operations lost the field. One finding names `Money`, because that is
    // the thing a person would fix — the alternative is four rectangles pointing
    // at one edit.
    expect(deltas).toEqual([
      {
        change: 'field-removed',
        at: { kind: 'type', type: 'Money', member: 'currency' },
        positions: ['response'],
        band: 'contract',
      },
    ]);
  });
});

it.todo(
  'an OpenAPI description becomes an `InterfaceDocument`, so this compares two revisions of a real file rather than two fixtures built to agree with it — needs a dialect reader in its own package, because `core` carries no third-party dependency and no parser worth reading a description with is dependency-free',
);
