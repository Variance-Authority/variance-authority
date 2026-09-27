import { describe, expect, it } from 'vitest';
import type { Loaded } from './compare.js';
import type { Region } from './read.js';

/**
 * The comparison as it ships: built, because the story format it reads
 * `require`s its neighbours by the names the build gives them.
 */
const { compareLoaded } = (await import('../../dist/story/compare.js')) as typeof import('./compare.js');

const ROOT = '/checkout';

/** `cart.ts`: a function holding a loop with an `if` in it, and a helper. */
const CART: Region[] = [
  { kind: 'module', name: '', path: 'module', startLine: 1, endLine: 40 },
  { kind: 'function', name: 'removeItem', path: 'entry', startLine: 12, endLine: 30 },
  { kind: 'loop', name: 'removeItem', path: 'for#0/body', startLine: 18, endLine: 20 },
  { kind: 'branch', name: 'removeItem', path: 'for#0/body/if#0/then', startLine: 19, endLine: 19 },
  { kind: 'function', name: 'price', path: 'entry', startLine: 32, endLine: 36 },
];

/** One reading over `cart.ts` (0–4) and `format.ts` (5–6, no regions held), from ordinals and what was said after how many visits. */
function reading(visits: number[], said: [number, string][] = [], stopped = false): Loaded {
  return {
    story: {
      file: '/checkout/src/cart.test.ts',
      name: 'cart > removes the last item',
      rows: [['src/cart.ts', 5], ['src/format.ts', 2]],
      before: Int32Array.from([]),
      visits: Int32Array.from(visits),
      untaped: 0,
      interleaved: 0,
      notes: said,
      beforeNotes: [],
      unnoted: 0,
      stopped,
    },
    files: ['src/cart.ts', 'src/format.ts'],
    regions: [CART, undefined],
  };
}

const passed = (...readings: Loaded[]) => ({ name: 'passed', readings });
const threw = (...readings: Loaded[]) => ({ name: 'threw', readings });

describe('two sides of a case', () => {
  it('are told apart by an arm one side took on every reading and the other on none', () => {
    const comparison = compareLoaded(
      ROOT,
      passed(reading([1, 2, 3, 4]), reading([1, 2, 3, 2, 4])),
      threw(reading([1, 2, 4], [], true), reading([1, 2, 2, 4], [], true)),
    );

    expect(comparison).toMatchObject({
      file: 'src/cart.test.ts',
      name: 'cart > removes the last item',
      sides: [{ name: 'passed', readings: 2, stopped: 0 }, { name: 'threw', readings: 2, stopped: 2 }],
      single: false,
    });
    expect(comparison.places[0].items).toEqual([{
      place: { file: 'src/cart.ts', name: 'removeItem', kind: 'function', startLine: 12, endLine: 30 },
      path: 'for#0/body/if#0/then',
      startLine: 19,
      endLine: 19,
      constructLine: 19,
    }]);
    expect(comparison.places[1].items).toEqual([]);
  });

  it('keep an order both sides hold every time, reversed between them, and count the order that moves within a side', () => {
    // `format.ts` finishes at another point on every run, so every order it is
    // in moves within a side; removeItem before price is the only order each
    // side holds, and they hold it the opposite way.
    const comparison = compareLoaded(
      ROOT,
      passed(reading([5, 1, 4]), reading([1, 5, 4])),
      threw(reading([4, 1, 5], [], true), reading([5, 4, 1], [], true)),
    );

    expect(comparison.reversed).toEqual([[
      { place: expect.objectContaining({ name: 'removeItem' }) },
      { place: expect.objectContaining({ name: 'price' }) },
    ]]);
    expect(comparison.unsteady.order).toBe(2);
    expect(comparison.places.flatMap((side) => side.items)).toEqual([]);
  });

  it('are told apart by a line one side said every time, and not by one whose text changes every run', () => {
    const comparison = compareLoaded(
      ROOT,
      passed(reading([1, 4], [[1, 'console.log stock 1'], [2, 'console.log at 1001']]), reading([1, 4], [[1, 'console.log stock 1'], [2, 'console.log at 1002']])),
      threw(reading([1, 4], [[1, 'console.log stock 0'], [2, 'console.log at 1003']], true), reading([1, 4], [[1, 'console.log stock 0']], true)),
    );

    expect(comparison.said.map((side) => side.items)).toEqual([['console.log stock 1'], ['console.log stock 0']]);
    expect(comparison.unsteady.said).toBe(3);
  });

  it('put a line said in order with the places around it', () => {
    const comparison = compareLoaded(
      ROOT,
      passed(reading([1, 4], [[1, 'eyes click on button "Save"']]), reading([1, 4], [[1, 'eyes click on button "Save"']])),
      threw(reading([1, 4], [[2, 'eyes click on button "Save"']]), reading([1, 4], [[2, 'eyes click on button "Save"']])),
    );

    expect(comparison.reversed).toEqual([[{ said: 'eyes click on button "Save"' }, { place: expect.objectContaining({ name: 'price' }) }]]);
  });

  it('name an arm of an `if` by the line its `then` starts on, the `else` an absent one is given as well', () => {
    // The walk gives an `if` with no `else` one anyway, on the line the `if` ends.
    const regions: Region[] = [
      { kind: 'function', name: 'checkout', path: 'entry', startLine: 10, endLine: 16 },
      { kind: 'branch', name: 'checkout', path: 'if#0/then', startLine: 13, endLine: 15 },
      { kind: 'branch', name: 'checkout', path: 'if#0/else', startLine: 15, endLine: 15 },
    ];
    const checkout = (visits: number[], stopped: boolean): Loaded => ({
      story: { ...reading([], [], stopped).story, rows: [['src/checkout.ts', 3]], visits: Int32Array.from(visits) },
      files: ['src/checkout.ts'],
      regions: [regions],
    });
    const comparison = compareLoaded(ROOT, passed(checkout([0, 2], false), checkout([0, 2], false)), threw(checkout([0, 1], true), checkout([0, 1], true)));

    const place = { file: 'src/checkout.ts', name: 'checkout', kind: 'function', startLine: 10, endLine: 16 };
    expect(comparison.places.map((side) => side.items)).toEqual([
      [{ place, path: 'if#0/else', startLine: 15, endLine: 15, constructLine: 13 }],
      [{ place, path: 'if#0/then', startLine: 13, endLine: 15, constructLine: 13 }],
    ]);
  });

  it('say so when a side has one reading, since one run cannot be told apart from a run that went another way', () => {
    const comparison = compareLoaded(ROOT, passed(reading([1, 4])), threw(reading([4, 1], [], true)));
    expect(comparison.single).toBe(true);
    expect(comparison.reversed).toHaveLength(1);
  });
});
