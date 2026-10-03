import { describe, expect, it } from 'vitest';
import {
  caseTwins,
  heldValues,
  nameIndex,
  outsideVocabulary,
  structuralParent,
  type ExecutionTest,
  type NameGrammar,
} from './index.js';

/**
 * What a case said, read on the axes `names.axes` declares, as a subject's name
 * is read on them.
 */

const SPEC = 'checkout.test.ts';
const at = (line: number) => `${SPEC}:${line}`;

const GRAMMAR: NameGrammar = {
  axes: [
    { axis: 'scheme', values: ['light', 'dark'] },
    { axis: 'flag', values: ['ff-off', 'ff-half', 'ff-on'] },
  ],
};

type Said = NonNullable<ExecutionTest['preconditions']>;

const said = (name: string, value: string | boolean, line: number) => ({ name, value, site: at(line), level: 1 });

function row(name: string, preconditions?: Said): ExecutionTest {
  return { id: `${SPEC} > ${name}`, file: SPEC, name, ...(preconditions === undefined ? {} : { preconditions }) };
}

describe('the values a case holds under a name', () => {
  it('is what it said, every value of a contradiction included', () => {
    expect(heldValues([said('network', 'mocked', 4)], 'network', GRAMMAR)).toEqual(['mocked']);
    expect(heldValues([said('flag', 'ff-off', 20), said('flag', 'ff-on', 19)], 'flag', GRAMMAR)).toEqual(['ff-off', 'ff-on']);
    expect(heldValues([said('seeded', true, 7)], 'seeded', GRAMMAR)).toEqual(['true']);
  });

  it('is the base of a declared axis the case never named', () => {
    expect(heldValues([said('network', 'mocked', 4)], 'flag', GRAMMAR)).toEqual(['ff-off']);
    expect(heldValues([], 'scheme', GRAMMAR)).toEqual(['light']);
  });

  it('is nothing for a name no axis declares and the case never said, with or without a grammar', () => {
    expect(heldValues([said('flag', 'ff-on', 9)], 'network', GRAMMAR)).toEqual([]);
    expect(heldValues([said('flag', 'ff-on', 9)], 'flag', undefined)).toEqual(['ff-on']);
    expect(heldValues([], 'flag', undefined)).toEqual([]);
  });
});

describe('a value outside an axis vocabulary', () => {
  it('is named with its axis, the call that said it and the values the axis takes', () => {
    expect(outsideVocabulary([said('flag', 'ff-onn', 30), said('network', 'mocked', 4), said('scheme', 'dark', 2)], GRAMMAR)).toEqual([
      { axis: 'flag', value: 'ff-onn', site: at(30), values: ['ff-off', 'ff-half', 'ff-on'] },
    ]);
  });

  it('is never found where no grammar is declared', () => {
    expect(outsideVocabulary([said('flag', 'ff-onn', 30)], undefined)).toEqual([]);
  });
});

describe('a case twin', () => {
  it('is the case one step toward the base on the last declared axis, as a subject parent is', () => {
    const cases = [
      row('dark ff-on', [said('scheme', 'dark', 1), said('flag', 'ff-on', 2)]),
      row('dark ff-off', [said('scheme', 'dark', 1), said('flag', 'ff-off', 2)]),
      row('light ff-on', [said('scheme', 'light', 1), said('flag', 'ff-on', 2)]),
    ];

    const parent = structuralParent('checkout-dark-ff-on', nameIndex(['checkout-dark-ff-on', 'checkout-dark', 'checkout-ff-on'], GRAMMAR));
    expect(parent).toEqual({ ok: true, parent: 'checkout-dark', step: { axis: 'flag', from: 'ff-off', to: 'ff-on' } });
    expect(caseTwins([cases[0]!], cases, GRAMMAR)).toEqual([
      { case: `${SPEC} > dark ff-on`, axis: 'flag', from: 'ff-on', to: 'ff-off', twins: [`${SPEC} > dark ff-off`] },
    ]);
  });

  it('walks past a step nobody holds to the base, keeps every case there, and is empty when none is', () => {
    const cases = [
      row('on', [said('flag', 'ff-on', 2)]),
      row('plain', []),
      row('also plain', [said('flag', 'ff-off', 5)]),
      row('on and seeded', [said('flag', 'ff-on', 2), said('seeded', true, 7)]),
    ];

    expect(caseTwins([cases[0]!, cases[3]!], cases, GRAMMAR)).toEqual([
      { case: `${SPEC} > on`, axis: 'flag', from: 'ff-on', to: 'ff-off', twins: [`${SPEC} > also plain`, `${SPEC} > plain`] },
      { case: `${SPEC} > on and seeded`, axis: 'flag', from: 'ff-on', to: 'ff-off', twins: [] },
    ]);
  });

  it('is not looked for from a case at the base, a contradiction, or a case nobody listened to', () => {
    const cases = [
      row('plain', []),
      row('contradicted', [said('flag', 'ff-off', 20), said('flag', 'ff-on', 19)]),
      row('unheard'),
      row('typo', [said('flag', 'ff-onn', 30)]),
    ];

    expect(caseTwins(cases, cases, GRAMMAR)).toEqual([]);
  });
});
