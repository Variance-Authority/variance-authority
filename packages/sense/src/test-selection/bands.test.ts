import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { bandRange, bandsOf, slice, tail } from './bands.js';
import { distanceFromView } from './distance.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { narrowByExecutionFromView } from './select.js';
import { baseDiff, layerCoverage, layerRecords } from './__fixtures__/layers.js';

const coverage = openTestCoverage(encodeTestCoverage(layerCoverage));
const distances = distanceFromView(coverage, narrowByExecutionFromView(coverage, baseDiff), {
  relations: relationsOfFiles(layerRecords),
});
const bands = bandsOf(distances);

describe('bandsOf', () => {
  it('rings the suite outwards from the change', () => {
    // The edit is in the base component and every one of these tests is
    // invalidated by it. The order is the whole product: the base's own test
    // fails first and for the simplest reason.
    expect(bands).toEqual([
      { hops: 1, tests: ['test/abstract-button.test.tsx'], unplaced: false },
      { hops: 2, tests: ['test/button.test.tsx', 'test/report.test.tsx'], unplaced: false },
      { hops: 3, tests: ['test/card.test.tsx'], unplaced: false },
      { hops: 4, tests: ['test/checkout.test.tsx'], unplaced: false },
      { tests: ['test/registry.test.ts'], unplaced: true },
    ]);
  });

  it('keeps a test nobody placed out of the near end', () => {
    // Unplaced is not band zero. A test with no measured path is the least
    // understood work in the run, and calling it nearest would run it first
    // under a claim nothing supports.
    const last = bands[bands.length - 1]!;

    expect(last.unplaced).toBe(true);
    expect(last).not.toHaveProperty('hops');
  });

  it('numbers the bands that occur rather than the hops that might have', () => {
    // A reading with a gap in it must still answer "the first three bands" with
    // three bands, or the same loop means different work in two checkouts.
    const sparse = bandsOf([
      { test: 'a.test.ts', bearing: 'direct', hops: 1 },
      { test: 'b.test.ts', bearing: 'transitive', hops: 7 },
    ]);

    expect(sparse.map(({ hops }) => hops)).toEqual([1, 7]);
    expect(slice(sparse, 1, 2)).toEqual(['a.test.ts', 'b.test.ts']);
  });
});

describe('slice', () => {
  it('runs the near end first', () => {
    expect(slice(bands, 1, 2)).toEqual([
      'test/abstract-button.test.tsx',
      'test/button.test.tsx',
      'test/report.test.tsx',
    ]);
  });

  it('leaves the unplaced to the leg that reaches the end', () => {
    // A leg that picks up where the last one stopped must not re-run what it
    // already ran, or a banded loop costs more than the whole suite — and the
    // near end must not be made expensive by everything nobody could place.
    expect(slice(bands, 1, 1)).toEqual(['test/abstract-button.test.tsx']);
    expect(slice(bands, 3, 4)).toEqual(['test/card.test.tsx', 'test/checkout.test.tsx']);
    expect(slice(bands, 5, 5)).toEqual(['test/registry.test.ts']);
  });

  it('names what it left behind rather than counting it', () => {
    expect(tail(bands, 1, 2)).toEqual([
      'test/card.test.tsx',
      'test/checkout.test.tsx',
      'test/registry.test.ts',
    ]);
    expect(tail(bands, 1, 9)).toEqual([]);
  });
});

describe('bandRange', () => {
  it('reads a leg, a single band, and the rest', () => {
    expect(bandRange('1-3')).toEqual({ from: 1, to: 3 });
    expect(bandRange('2')).toEqual({ from: 2, to: 2 });
    expect(bandRange('3-')).toMatchObject({ from: 3 });
    expect(slice(bands, 3, bandRange('3-')!.to)).toEqual([
      'test/card.test.tsx',
      'test/checkout.test.tsx',
      'test/registry.test.ts',
    ]);
  });

  it('refuses a range nobody meant, rather than running one band', () => {
    // A typo that quietly ran the first band would report a pass over a suite
    // nobody chose.
    expect(bandRange('3-1')).toBeUndefined();
    expect(bandRange('0')).toBeUndefined();
    expect(bandRange('all')).toBeUndefined();
    expect(bandRange('')).toBeUndefined();
  });
});
