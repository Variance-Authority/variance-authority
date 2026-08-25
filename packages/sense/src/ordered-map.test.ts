import { describe, expect, it } from 'vitest';
import { differenceLayer, lookupInLayers, materializeLayers, orderedMap } from './ordered-map.js';

describe('ordered immutable map layers', () => {
  const layers = [
    { puts: new Map([['a', 1], ['b', 2]]), deletes: new Set<string>() },
    { puts: new Map([['b', 3], ['c', 4]]), deletes: new Set(['a']) },
  ];

  it('lets the newest value or tombstone answer a point lookup', () => {
    expect(lookupInLayers(layers, 'a')).toBeUndefined();
    expect(lookupInLayers(layers, 'b')).toBe(3);
    expect(lookupInLayers(layers, 'c')).toBe(4);
  });

  it('materializes the same answer in application order', () => {
    expect([...materializeLayers(layers)]).toEqual([['b', 3], ['c', 4]]);
    const map = orderedMap(layers);
    expect(map.get('a')).toBeUndefined();
    expect(map.has('b')).toBe(true);
    expect([...map]).toEqual([['b', 3], ['c', 4]]);
  });

  it('writes only changes and tombstones', () => {
    const changed = differenceLayer(
      new Map([['same', { n: 1 }], ['changed', { n: 1 }], ['gone', { n: 1 }]]),
      new Map([['same', { n: 1 }], ['changed', { n: 2 }], ['new', { n: 1 }]]),
      (left, right) => left.n === right.n,
    );

    expect([...changed.puts]).toEqual([['changed', { n: 2 }], ['new', { n: 1 }]]);
    expect([...changed.deletes]).toEqual(['gone']);
  });
});
