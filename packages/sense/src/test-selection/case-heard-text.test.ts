import { describe, expect, it } from 'vitest';
import { heardSplit, heldText, readSplit, readsOf, saidRow } from './case-said.js';

type Item = [name: string, value: string | null, site: string, level: number];
const item = (name: string, value: unknown, site: string, level = 0xffff): Item => [name, JSON.stringify(value), site, level];
const heard = (said: readonly Item[], read?: readonly Item[], misused?: readonly Item[]) =>
  ({ said: JSON.stringify({ said, ...(read === undefined ? {} : { read }), ...(misused === undefined ? {} : { misused }) }) });

describe('what a reader prints of what a case heard', () => {
  it('prints each key the code read with the value it read and the value the case said, or said nothing', () => {
    expect(heldText(heard(
      [item('flags:new-checkout', true, 'pay.test.ts:3')],
      [item('flags:new-checkout', true, 'pay.ts:41'), item('flags:retries', 2, 'pay.ts:60')],
    ))).toBe(' — read flags:new-checkout=true said true, read flags:retries=2 said nothing');
  });

  it('prints nothing about reads for a case whose code read nothing, which every case of a codebase without breadcrumbs is', () => {
    expect(heldText(heard([], []))).toBe('');
    expect(heldText(heard([item('flags:new-checkout', true, 'pay.test.ts:3')], []))).toBe(' — flags:new-checkout (pay.test.ts:3)');
  });

  it('drops a key said and never read in a dimension the case read, and prints a dimension never read as it was said', () => {
    expect(heldText(heard(
      [
        item('flags:new-checkout', false, 'pay.test.ts:3'),
        item('flags:dark-mode', true, 'pay.test.ts:3'),
        item('fixture:network', 'mocked', 'pay.test.ts:5', 1),
      ],
      [item('flags:new-checkout', false, 'pay.ts:41')],
    ))).toBe(' — read flags:new-checkout=false said false, fixture:network=mocked (pay.test.ts:5)');
  });

  it('prints each value one key was read with, and both values of a contradiction the case said', () => {
    expect(heldText(heard(
      [item('flags:checkout', 'on', 'a.test.ts:4', 1), item('flags:checkout', 'off', 'a.test.ts:5', 1)],
      [item('flags:checkout', 'off', 'pay.ts:41'), item('flags:checkout', 'on', 'pay.ts:41')],
    ))).toBe(' — read flags:checkout=off said off and on, read flags:checkout=on said off and on');
  });

  it('prints a misused breadcrumb with its site and what was wrong, after the reads, and never as a read', () => {
    const misused = [item('dimension', 7, 'pay.ts:9')];
    expect(heldText(heard(
      [item('flags:checkout', true, 'pay.test.ts:3')],
      [item('flags:checkout', true, 'pay.ts:41')],
      misused,
    ))).toBe(' — read flags:checkout=true said true, misused varianceBreadcrumb at pay.ts:9: the dimension 7 is not a string');
    expect(heldText(heard([item('flags:checkout', true, 'pay.test.ts:3')], [], misused)))
      .toBe(' — flags:checkout (pay.test.ts:3), misused varianceBreadcrumb at pay.ts:9: the dimension 7 is not a string');
  });

  it('says what was wrong from the argument and the value it was given', () => {
    const misused = (argument: string, value: unknown) => heldText(heard([], [], [[argument, value === undefined ? null : JSON.stringify(value), 'pay.ts:9', 0xffff]]));
    expect([
      misused('key', 7),
      misused('key', ''),
      misused('dimension', ''),
      misused('dimension', 'flags:x'),
      misused('dimension', [1]),
      misused('key', { a: 1 }),
      misused('key', null),
      misused('dimension', undefined),
    ].map((text) => text.slice(text.indexOf(': ') + 2))).toEqual([
      'the key 7 is not a string',
      'the key is empty',
      'the dimension is empty',
      'the dimension "flags:x" holds `:`',
      'the dimension an array is not a string',
      'the key an object is not a string',
      'the key null is not a string',
      'the dimension is not a string',
    ]);
  });

  it('prints what the case said as spec 0093 does where nobody listened to reads, and nothing for a case that said nothing', () => {
    expect(heldText(heard([item('fixture:network', 'mocked', 'a.test.ts:5', 1)]))).toBe(' — fixture:network=mocked (a.test.ts:5)');
    expect(heldText(heard([]))).toBe('');
    expect(heldText({})).toBe('');
  });
});

describe('how the cases that entered one region split by what the code read', () => {
  const reads = (...items: readonly [string, unknown][]) => items.map(([name, value]) => ({ name, value, site: 'pay.ts:41', level: 0xffff }));

  it('names each value a key was read with, by how many cases, and the cases that never read it', () => {
    expect(readSplit([
      reads(['flags:checkout', true]),
      reads(['flags:checkout', true]),
      reads(['flags:checkout', false]),
      reads(),
    ])).toBe('flags:checkout read false by 1, true by 2, not by 1');
  });

  it('names a key every case read at one value too: which value reached the region is the reading', () => {
    expect(readSplit([reads(['copy:label', 'Pay'], ['flags:checkout', true]), reads(['copy:label', 'Pay'])]))
      .toBe('copy:label read Pay by 2; flags:checkout read true by 1, not by 1');
    expect(readSplit([reads(), reads()])).toBe('');
  });

  it('counts a case that read a key both ways under each value', () => {
    expect(readSplit([reads(['flags:checkout', false], ['flags:checkout', true]), reads(['flags:checkout', true])]))
      .toBe('flags:checkout read false by 1, true by 2');
  });

  it('counts the cases nobody listened to for reads apart, and says nothing when no case was listened to', () => {
    expect(readSplit([reads(['flags:checkout', true]), undefined])).toBe('flags:checkout read true by 1, unmeasured for 1');
    expect(readSplit([undefined, undefined])).toBe('');
  });
});

describe('how the cases that entered one region split by what they heard', () => {
  it('names each misused breadcrumb after the reads, by its site, what was wrong and how many cases met it', () => {
    const read = [{ name: 'flags:checkout', value: true, site: 'pay.ts:41', level: 0xffff }];
    const misused = [{ argument: 'key', value: 7, site: 'pay.ts:9', level: 0xffff }];
    expect(heardSplit([{ reads: read, misused }, { reads: read, misused }, { reads: [] }]))
      .toBe('flags:checkout read true by 2, not by 1; misused varianceBreadcrumb at pay.ts:9 by 2: the key 7 is not a string');
    expect(heardSplit([{ reads: [], misused }])).toBe('misused varianceBreadcrumb at pay.ts:9 by 1: the key 7 is not a string');
    expect(heardSplit([{ reads: read }])).toBe('flags:checkout read true by 1');
  });
});

describe('a misused breadcrumb on a resolved row', () => {
  it('is a facet of its own, the argument that was wrong and what it was given, which no read of the case holds', () => {
    const test = heard([], [item('flags:checkout', true, 'pay.ts:41')], [item('key', 7, 'pay.ts:9')]);
    expect(saidRow(test.said)).toEqual({
      said: [],
      read: [{ name: 'flags:checkout', value: true, site: 'pay.ts:41', level: 0xffff }],
      misused: [{ argument: 'key', value: 7, site: 'pay.ts:9', level: 0xffff }],
    });
    expect(readsOf(test)).toEqual([{ name: 'flags:checkout', value: true, site: 'pay.ts:41', level: 0xffff }]);
  });

  it('is absent from a row nobody listened to for it, and empty where nothing was misused', () => {
    expect(saidRow(heard([], [item('flags:checkout', true, 'pay.ts:41')]).said)).not.toHaveProperty('misused');
    expect(saidRow(heard([], [], []).said).misused).toEqual([]);
  });
});
