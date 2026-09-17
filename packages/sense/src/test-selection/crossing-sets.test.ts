import { describe, expect, it } from 'vitest';
import { BITS, CrossingSets, LIST, RUNS, containerSizes } from './crossing-sets.js';
import { blocksCrossedBy, openCrossingSets, openPackedCrossingSets, packCrossingSets } from './crossing-sets-read.js';

/** A deterministic stream, so a failing case is the same case next run. */
const stream = (seed: number): (() => number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
};

const sorted = (tests: Iterable<number>): number[] => [...new Set(tests)].sort((a, b) => a - b);

describe('the pool', () => {
  it('gives equal sets one id and unequal sets different ones', () => {
    const sets = new CrossingSets(64);
    const first = sets.intern([3, 9, 12]);
    const again = sets.intern([12, 3, 9]);
    const duplicated = sets.intern([3, 3, 9, 12, 12]);
    const other = sets.intern([3, 9, 13]);

    expect(again).toBe(first);
    expect(duplicated).toBe(first);
    expect(other).not.toBe(first);
    expect(sets.size).toBe(2);
  });

  it('holds the empty set once, and it answers nothing', () => {
    const sets = new CrossingSets(64);
    expect(sets.intern([])).toBe(sets.intern([]));
    const view = openCrossingSets(sets.pool());
    expect(view.count(0)).toBe(0);
    expect([...view.members(0)]).toEqual([]);
    expect(view.has(0, 0)).toBe(false);
  });

  it('answers every member and no others, across every container', () => {
    const next = stream(20250915);
    const testCount = 2000;
    const sets = new CrossingSets(testCount);
    const expected: number[][] = [];

    for (let round = 0; round < 200; round += 1) {
      const shape = round % 4;
      const members: number[] = [];
      if (shape === 0) {
        for (let at = 0; at < 1 + Math.floor(next() * 4); at += 1) {
          members.push(Math.floor(next() * testCount));
        }
      } else if (shape === 1) {
        const first = Math.floor(next() * (testCount - 200));
        for (let at = 0; at < 1 + Math.floor(next() * 200); at += 1) members.push(first + at);
      } else if (shape === 2) {
        for (let test = 0; test < testCount; test += 1) if (next() < 0.3) members.push(test);
      } else {
        for (let test = 0; test < testCount; test += 1) members.push(test);
      }
      expected.push(sorted(members));
      sets.intern(members);
    }

    const view = openCrossingSets(sets.pool());
    const byMembers = new Map(expected.map((members) => [members.join(','), members]));
    expect(view.size).toBe(byMembers.size);

    for (const members of byMembers.values()) {
      const id = sets.intern(members);
      expect([...view.members(id)]).toEqual(members);
      expect(view.count(id)).toBe(members.length);
      const held = new Set(members);
      for (let test = 0; test < testCount; test += 1) {
        expect(view.has(id, test)).toBe(held.has(test));
      }
    }
  });
});

describe('the container', () => {
  it('lists a sparse set, runs a contiguous one, and bitmaps the middle', () => {
    const testCount = 2000;
    const sets = new CrossingSets(testCount);

    const sparse = sets.intern([4, 900, 1500]);
    const contiguous = sets.intern(Array.from({ length: 400 }, (_, at) => 100 + at));
    const scattered: number[] = [];
    for (let test = 0; test < testCount; test += 2) scattered.push(test);
    const middle = sets.intern(scattered);

    const view = openCrossingSets(sets.pool());
    expect(view.containerOf(sparse)).toBe(LIST);
    expect(view.containerOf(contiguous)).toBe(RUNS);
    expect(view.containerOf(middle)).toBe(BITS);
  });

  it('costs nine bytes for the whole suite, whatever the suite is', () => {
    for (const testCount of [100, 2000, 50_000]) {
      const all = Array.from({ length: testCount }, (_, at) => at);
      const sizes = containerSizes(all, all.length, testCount);
      expect(Math.min(sizes.list, sizes.bits, sizes.runs)).toBe(sizes.runs);
      expect(sizes.runs).toBe(testCount < 0x1_0000 ? 5 : 9);
    }
  });

  it('widens past sixty-five thousand tests', () => {
    const testCount = 70_000;
    const sets = new CrossingSets(testCount);
    const id = sets.intern([0, 69_999]);
    const view = openCrossingSets(sets.pool());
    expect([...view.members(id)]).toEqual([0, 69_999]);
    expect(view.has(id, 69_999)).toBe(true);
    expect(view.has(id, 69_998)).toBe(false);
  });
});

describe('the reverse direction', () => {
  it('names the same regions a scan of the relation would', () => {
    const next = stream(99);
    const testCount = 300;
    const blocks = 5000;
    const sets = new CrossingSets(testCount);
    const ids = new Uint32Array(blocks);
    const relation: number[][] = [];

    for (let block = 0; block < blocks; block += 1) {
      const members: number[] = [];
      // A handful of shapes, repeated, so interning has something to collapse.
      const shape = Math.floor(next() * 12);
      const first = shape * 20;
      for (let at = 0; at < shape + 1; at += 1) members.push((first + at) % testCount);
      relation.push(sorted(members));
      ids[block] = sets.intern(members);
    }

    const view = openCrossingSets(sets.pool());
    for (const test of [0, 7, 42, 199, 299]) {
      const expected = relation.flatMap((members, block) => (members.includes(test) ? [block] : []));
      expect([...blocksCrossedBy(ids, view, test)]).toEqual(expected);
    }
  });
});

describe('the whole relation', () => {
  it('survives a round trip through the pool unchanged', () => {
    const next = stream(31337);
    const testCount = 500;
    const blocks = 20_000;
    const sets = new CrossingSets(testCount);
    const ids = new Uint32Array(blocks);
    const relation: number[][] = [];

    for (let block = 0; block < blocks; block += 1) {
      const members: number[] = [];
      const size = Math.floor(next() * 40);
      const first = Math.floor(next() * (testCount - size - 1));
      for (let at = 0; at < size; at += 1) {
        members.push(next() < 0.7 ? first + at : Math.floor(next() * testCount));
      }
      relation.push(sorted(members));
      ids[block] = sets.intern(members);
    }

    const view = openCrossingSets(sets.pool());
    for (let block = 0; block < blocks; block += 1) {
      expect([...view.members(ids[block]!)]).toEqual(relation[block]);
    }

    // The point of the exercise: far fewer sets than regions.
    expect(view.size).toBeLessThan(blocks);
  });
});

describe('the stored pool', () => {
  it('answers the same as the built one, through the column encoding', () => {
    const next = stream(4242);
    const testCount = 1200;
    const sets = new CrossingSets(testCount);
    const expected: number[][] = [];

    // Every container, and enough sets to cross a blob run boundary.
    for (let round = 0; round < 1500; round += 1) {
      const members: number[] = [];
      const shape = round % 3;
      if (shape === 0) {
        for (let at = 0; at < 1 + Math.floor(next() * 5); at += 1) {
          members.push(Math.floor(next() * testCount));
        }
      } else if (shape === 1) {
        const first = Math.floor(next() * (testCount - 300));
        for (let at = 0; at < 1 + Math.floor(next() * 300); at += 1) members.push(first + at);
      } else {
        for (let test = 0; test < testCount; test += 1) if (next() < 0.4) members.push(test);
      }
      expected.push(sorted(members));
      sets.intern(members);
    }

    const pool = sets.pool();
    const packed = packCrossingSets(pool);
    const stored = openCrossingSets(
      openPackedCrossingSets(packed.sets, packed.offsets, sets.size, testCount),
    );
    const built = openCrossingSets(pool);

    expect(stored.size).toBe(built.size);
    for (let set = 0; set < built.size; set += 1) {
      expect([...stored.members(set)]).toEqual([...built.members(set)]);
      expect(stored.count(set)).toBe(built.count(set));
      expect(stored.containerOf(set)).toBe(built.containerOf(set));
    }
    for (const members of expected) {
      const id = sets.intern(members);
      expect([...stored.members(id)]).toEqual(members);
    }

    // Worth stating as a number: the sets cost less stored than the pointers
    // an equivalent array of arrays would spend on nothing but addresses.
    const crossings = expected.reduce((total, members) => total + members.length, 0);
    expect(packed.sets.length + packed.offsets.length).toBeLessThan(crossings * 4);
  });
});
