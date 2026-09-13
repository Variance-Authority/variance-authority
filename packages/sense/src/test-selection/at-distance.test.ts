import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { atDistance, distanceRange, groupByDistance, remaining } from './at-distance.js';
import { distanceFromView } from './distance.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { narrowByExecutionFromView } from './select.js';
import { baseDiff, layerCoverage, layerRecords } from './__fixtures__/layers.js';

const coverage = openTestCoverage(encodeTestCoverage(layerCoverage));
const distances = distanceFromView(coverage, narrowByExecutionFromView(coverage, baseDiff), {
  relations: relationsOfFiles(layerRecords),
});

describe('groupByDistance', () => {
  it('rings the suite outwards from the change', () => {
    // The edit is in the base component and every one of these tests is
    // invalidated by it. The order is the whole product: the base's own test
    // fails first and for the simplest reason.
    expect(groupByDistance(distances)).toEqual([
      { hops: 1, tests: ['test/abstract-button.test.tsx'], unplaced: false },
      { hops: 2, tests: ['test/button.test.tsx', 'test/report.test.tsx'], unplaced: false },
      { hops: 3, tests: ['test/card.test.tsx'], unplaced: false },
      { hops: 4, tests: ['test/checkout.test.tsx'], unplaced: false },
      { tests: ['test/registry.test.ts'], unplaced: true },
    ]);
  });

  it('keeps a test nobody placed out of the near end', () => {
    // Unplaced is not distance zero. A test with no measured path is the least
    // understood work in the run, and calling it nearest would run it first
    // under a claim nothing supports.
    const groups = groupByDistance(distances);
    const last = groups[groups.length - 1]!;

    expect(last.unplaced).toBe(true);
    expect(last).not.toHaveProperty('hops');
  });

  it('reports the hop counts that occur and not the ones that might have', () => {
    const sparse = groupByDistance([
      { test: 'a.test.ts', bearing: 'direct', hops: 1 },
      { test: 'b.test.ts', bearing: 'transitive', hops: 7 },
    ]);

    expect(sparse.map(({ hops }) => hops)).toEqual([1, 7]);
  });
});

describe('atDistance', () => {
  it('runs the near end first', () => {
    expect(atDistance(distances, 0, 2)).toEqual([
      'test/abstract-button.test.tsx',
      'test/button.test.tsx',
      'test/report.test.tsx',
    ]);
  });

  it('answers a range nothing is that close to with nothing', () => {
    // The literal answer, and the one a loop can act on: no test is within two
    // hops, so the near leg costs nothing and the far leg runs all of them. A
    // range renumbered to the groups that happened would have run the four-hop
    // tests here and called them the nearest.
    const far = [
      { test: 'a.test.ts', bearing: 'transitive', hops: 4 },
      { test: 'b.test.ts', bearing: 'transitive', hops: 5 },
    ] as const;

    expect(atDistance(far, 0, 2)).toEqual([]);
    expect(atDistance(far, 3, Number.MAX_SAFE_INTEGER)).toEqual(['a.test.ts', 'b.test.ts']);
  });

  it('leaves the unplaced to the leg that reaches the end', () => {
    // A leg that picks up where the last one stopped must not re-run what it
    // already ran, or a banded loop costs more than the whole suite — and the
    // near end must not be made expensive by everything nobody could place.
    expect(atDistance(distances, 0, 1)).toEqual(['test/abstract-button.test.tsx']);
    expect(atDistance(distances, 3, 4)).toEqual([
      'test/card.test.tsx',
      'test/checkout.test.tsx',
      'test/registry.test.ts',
    ]);
    expect(atDistance(distances, 0, 2)).not.toContain('test/registry.test.ts');
  });

  it('carries the unplaced only on an open leg when nothing was placed at all', () => {
    // Every test unplaced is the no-graph reading, and there is no furthest
    // distance for a closed leg to reach past. Carrying them on both legs of a
    // loop would run them twice; carrying them on neither open one would lose
    // them.
    const blind = [
      { test: 'a.test.ts', bearing: 'unmeasured', because: 'no graph' },
      { test: 'b.test.ts', bearing: 'unexplained' },
    ] as const;

    expect(atDistance(blind, 0, 2)).toEqual([]);
    expect(atDistance(blind, 3, Number.MAX_SAFE_INTEGER)).toEqual(['a.test.ts', 'b.test.ts']);
  });

  it('takes a test whose own source changed at no distance at all', () => {
    // Zero is a distance and a common one in an edit loop, so a near leg spelled
    // from one would post the edited file's own test to the end of the run.
    const own = [{ test: 'a.test.ts', bearing: 'precondition', hops: 0 }] as const;

    expect(atDistance(own, 0, 2)).toEqual(['a.test.ts']);
    expect(atDistance(own, 1, 2)).toEqual([]);
  });
});

describe('remaining', () => {
  it('names what it left behind rather than counting it', () => {
    expect(remaining(distances, 0, 2)).toEqual([
      'test/card.test.tsx',
      'test/checkout.test.tsx',
      'test/registry.test.ts',
    ]);
    expect(remaining(distances, 0, Number.MAX_SAFE_INTEGER)).toEqual([]);
  });
});

describe('distanceRange', () => {
  it('reads a leg, a single distance, and the rest', () => {
    expect(distanceRange('0-2')).toEqual({ from: 0, to: 2 });
    expect(distanceRange('2')).toEqual({ from: 2, to: 2 });
    expect(distanceRange('3-')).toMatchObject({ from: 3 });
    expect(atDistance(distances, 3, distanceRange('3-')!.to)).toEqual([
      'test/card.test.tsx',
      'test/checkout.test.tsx',
      'test/registry.test.ts',
    ]);
  });

  it('refuses a range nobody meant, rather than running one distance', () => {
    // A typo that quietly ran the nearest tests would report a pass over a suite
    // nobody chose.
    expect(distanceRange('3-1')).toBeUndefined();
    expect(distanceRange('all')).toBeUndefined();
    expect(distanceRange('')).toBeUndefined();
  });
});
