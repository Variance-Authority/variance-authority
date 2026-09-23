import { describe, expect, it } from 'vitest';
import { relationsOfFiles } from '@variance-authority/core/relate';
import {
  coveringChange,
  coveringTests,
  coveringTestsInFile,
  type ExecutionIndex,
} from './reverse.js';

const index: ExecutionIndex = {
  tests: [
    { id: 'guest', file: 'test/cart.test.ts', name: 'uses the guest price' },
    { id: 'other-staff', file: 'test/other.test.ts', name: 'applies the staff discount' },
    { id: 'staff', file: 'test/cart.test.ts', name: 'applies the staff discount' },
  ],
  modules: [{
    file: 'src/cart/total.ts',
    blocks: [
      {
        kind: 'function',
        name: 'priceOf',
        path: 'entry',
        startLine: 1,
        endLine: 10,
        source: true,
        crossings: [
          { test: 0, distance: 5 },
          { test: 2, distance: 3 },
          { test: 1, distance: 4 },
          { test: 2, distance: 2 },
        ],
      },
      {
        kind: 'branch',
        name: 'priceOf',
        path: 'if#0/then',
        startLine: 3,
        endLine: 5,
        source: true,
        crossings: [{ test: 2, distance: 3 }],
      },
      {
        kind: 'branch',
        name: 'priceOf',
        path: 'if#0/else',
        startLine: 6,
        endLine: 8,
        source: false,
        crossings: [{ test: 0, distance: 6 }],
      },
      {
        kind: 'statement',
        name: 'unreached',
        path: 'statement#0',
        startLine: 12,
        endLine: 12,
        source: true,
        crossings: [],
      },
    ],
  }],
};

describe('coveringTests', () => {
  it('answers a line from its innermost real source region', () => {
    expect(coveringTests(index, { file: 'src/cart/total.ts', line: 4 })).toEqual([
      {
        id: 'staff',
        file: 'test/cart.test.ts',
        name: 'applies the staff discount',
        distance: 3,
      },
    ]);
  });

  it('answers a function with named tests ordered by their minimum depth', () => {
    expect(coveringTests(index, { file: 'src/cart/total.ts', function: 'priceOf' })).toEqual([
      {
        id: 'staff',
        file: 'test/cart.test.ts',
        name: 'applies the staff discount',
        distance: 2,
      },
      {
        id: 'other-staff',
        file: 'test/other.test.ts',
        name: 'applies the staff discount',
        distance: 4,
      },
      {
        id: 'guest',
        file: 'test/cart.test.ts',
        name: 'uses the guest price',
        distance: 5,
      },
    ]);
  });

  it('returns no claim for source the index does not cover', () => {
    expect(coveringTests(index, { file: 'src/cart/total.ts', line: 20 })).toEqual([]);
    expect(coveringTests(index, { file: 'src/cart/total.ts', function: 'missing' })).toEqual([]);
  });
});

describe('coveringTestsInFile', () => {
  it('answers every indexed line as compact ranges', () => {
    const ranges = coveringTestsInFile(index, 'src/cart/total.ts');
    expect(ranges).toEqual([
      {
        startLine: 1,
        endLine: 2,
        tests: [
          {
            id: 'staff',
            file: 'test/cart.test.ts',
            name: 'applies the staff discount',
            distance: 2,
          },
          {
            id: 'other-staff',
            file: 'test/other.test.ts',
            name: 'applies the staff discount',
            distance: 4,
          },
          {
            id: 'guest',
            file: 'test/cart.test.ts',
            name: 'uses the guest price',
            distance: 5,
          },
        ],
      },
      {
        startLine: 3,
        endLine: 5,
        tests: [{
          id: 'staff',
          file: 'test/cart.test.ts',
          name: 'applies the staff discount',
          distance: 3,
        }],
      },
      {
        startLine: 6,
        endLine: 10,
        tests: [
          {
            id: 'staff',
            file: 'test/cart.test.ts',
            name: 'applies the staff discount',
            distance: 2,
          },
          {
            id: 'other-staff',
            file: 'test/other.test.ts',
            name: 'applies the staff discount',
            distance: 4,
          },
          {
            id: 'guest',
            file: 'test/cart.test.ts',
            name: 'uses the guest price',
            distance: 5,
          },
        ],
      },
      { startLine: 12, endLine: 12, tests: [] },
    ]);
    for (const range of ranges) {
      for (let line = range.startLine; line <= range.endLine; line += 1) {
        expect(range.tests).toEqual(coveringTests(index, {
          file: 'src/cart/total.ts',
          line,
        }));
      }
    }
  });

  it('returns no claim for a file absent from the index', () => {
    expect(coveringTestsInFile(index, 'src/missing.ts')).toEqual([]);
  });
});

/**
 * The reading a review asks for, and the three ways a changed file has no rows.
 *
 * Every case here is one a reviewer would otherwise read as *covered*: a region
 * whose only visitors were carried in by module evaluation, a file the run
 * never loaded, and the test file the reviewer just edited — which has no
 * module row anywhere and is the file a per-case reading is asked about most.
 */
describe('coveringChange', () => {
  const changed = (file: string, start: number, end: number) =>
    new Map([[file, [{ start, end }]]]);

  it('splits the cases that called into a region from the ones evaluation carried in', () => {
    const [file] = coveringChange({
      tests: index.tests,
      modules: [{
        file: 'src/cart/total.ts',
        blocks: [{
          kind: 'function', name: 'priceOf', path: 'entry', startLine: 1, endLine: 10, source: true,
          crossings: [{ test: 0, distance: 2 }, { test: 1, distance: 0, loaded: true }],
        }],
      }],
    }, changed('src/cart/total.ts', 4, 4));

    expect(file?.regions[0]?.tests.map((test) => test.id)).toEqual(['guest']);
    expect(file?.regions[0]?.passengers.map((test) => test.id)).toEqual(['other-staff']);
  });

  it('drops every case whose file mocked the module, whatever it crossed there', () => {
    // Both test files mock `total.ts`. `other.test.ts` was only on the blocks
    // while the runner evaluated the real module to shape its automock;
    // `cart.test.ts` called in, which is a mock that did not take and still not
    // the module's audience.
    const mocked = ['test/cart.test.ts', 'test/other.test.ts'];
    const relations = relationsOfFiles(
      [{ file: 'src/cart/total.ts' }, ...mocked.map((file) => ({ file, edges: [{ to: 'src/cart/total.ts', kind: 'imports' as const }] }))],
      { shadows: new Map(mocked.map((file) => [file, ['src/cart/total.ts']])) },
    );
    const [file] = coveringChange({
      tests: index.tests,
      modules: [{
        file: 'src/cart/total.ts',
        blocks: [{
          kind: 'function', name: 'priceOf', path: 'entry', startLine: 1, endLine: 10, source: true,
          crossings: [{ test: 0, distance: 2 }, { test: 1, distance: 0, loaded: true }, { test: 2, distance: 0, loaded: true }],
        }],
      }],
    }, changed('src/cart/total.ts', 4, 4), { relations });

    expect(file?.regions[0]?.tests).toEqual([]);
    expect(file?.regions[0]?.passengers).toEqual([]);
  });

  it('reports a changed region no case entered rather than leaving it out', () => {
    const [file] = coveringChange(index, changed('src/cart/total.ts', 12, 12));

    expect(file?.regions.map((region) => [region.name, region.tests.length])).toEqual([
      ['unreached', 0],
    ]);
  });

  it('separates a file the run never loaded from a file whose regions nobody entered', () => {
    const [file] = coveringChange(index, changed('src/missing.ts', 1, 3));

    expect(file).toEqual({ file: 'src/missing.ts', recorded: false, regions: [], cases: [] });
  });

  it('names the cases a changed test file declares, which have no module row anywhere', () => {
    const [file] = coveringChange(index, changed('test/cart.test.ts', 1, 40));

    expect(file?.recorded).toBe(false);
    expect(file?.cases.map((test) => test.id)).toEqual(['guest', 'staff']);
  });

  it('keeps a region the change only overlaps at one end', () => {
    const [file] = coveringChange(index, changed('src/cart/total.ts', 10, 11));

    expect(file?.regions.map((region) => [region.startLine, region.endLine])).toEqual([[1, 10]]);
  });
});
