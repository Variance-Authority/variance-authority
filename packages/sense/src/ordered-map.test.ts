import { describe, expect, it } from 'vitest';
import { differenceLayer, prunable, readonlyMap } from './ordered-map.js';

describe('ordered immutable map layers', () => {
  it('drops entries from a map it never copies', () => {
    const base = new Map([['a', 1], ['b', 2], ['c', 3]]);
    const map = prunable(base);
    expect(map.delete('b')).toBe(true);
    expect(map.delete('b')).toBe(false);
    expect(map.size).toBe(2);
    expect(map.get('b')).toBeUndefined();
    expect([...map]).toEqual([['a', 1], ['c', 3]]);
    map.clear();
    expect(map.size).toBe(0);
    expect(map.has('a')).toBe(false);
    expect([...map.keys()]).toEqual([]);
    expect(base.size).toBe(3);
  });

  it('answers every read a map has over a source that lists only its entries', () => {
    const rows = new Map([['a', 1], ['b', 2]]);
    const map = readonlyMap({ size: () => rows.size, get: (key: string) => rows.get(key), has: (key: string) => rows.has(key), entries: () => rows.entries() });
    expect([...map.entries()]).toEqual([['a', 1], ['b', 2]]);
    expect([...map.keys()]).toEqual(['a', 'b']);
    expect([...map.values()]).toEqual([1, 2]);
    const seen: [string, number, ReadonlyMap<string, number>][] = [];
    map.forEach((value, key, owner) => seen.push([key, value, owner]));
    expect(seen).toEqual([['a', 1, map], ['b', 2, map]]);
  });

  it('finds a map handed back as it was read unchanged, without walking it', () => {
    const walked = new Map([['a', 1]]);
    const untouched = { ...walked, [Symbol.iterator]: () => { throw new Error('walked'); } } as unknown as Map<string, number>;
    expect(differenceLayer(untouched, untouched)).toEqual({ puts: new Map(), deletes: new Set() });
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
