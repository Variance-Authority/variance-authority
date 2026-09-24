import { describe, expect, it } from 'vitest';
import { relationsOfFiles } from '@variance-authority/core/relate';
import { coveringChange, coveringTestsInFile, stoppedBefore, type ExecutionIndex } from './reverse.js';
import { anyStopped } from './stopped.js';

// `total.ts` has `priceOf` at 1-4 and `refund` at 6-9. `guest` walks `priceOf`
// and finishes; `staff` enters `priceOf` and throws before it gets to `refund`;
// `other` imports the module and entered nothing.
const settled = (staff: boolean | undefined, other: boolean | undefined): ExecutionIndex => ({
  tests: [
    { id: 'guest', file: 'test/cart.test.ts', name: 'uses the guest price', stopped: false },
    { id: 'staff', file: 'test/cart.test.ts', name: 'refunds the staff price', ...(staff === undefined ? {} : { stopped: staff }) },
    { id: 'other', file: 'test/other.test.ts', name: 'refunds twice', ...(other === undefined ? {} : { stopped: other }) },
  ],
  modules: [{
    file: 'src/cart/total.ts',
    blocks: [
      { kind: 'function', name: 'priceOf', path: 'entry#0', startLine: 1, endLine: 4, source: true, crossings: [{ test: 0, distance: 0 }, { test: 1, distance: 0 }] },
      { kind: 'function', name: 'refund', path: 'entry#1', startLine: 6, endLine: 9, source: true, crossings: [] },
    ],
  }],
});
const importers = (files: readonly string[]) => relationsOfFiles(
  [{ file: 'src/cart/total.ts' }, ...files.map((file) => ({ file, edges: [{ to: 'src/cart/total.ts', kind: 'imports' as const }] }))],
);
const refund = { file: 'src/cart/total.ts', line: 7 };
const ids = (tests: readonly { readonly id: string }[] | undefined) => tests?.map((test) => test.id);

describe('a case that stopped before reaching a region', () => {
  const relations = importers(['test/cart.test.ts', 'test/other.test.ts']);

  it('makes the region a hole, and names every case the graph says could have reached it', () => {
    expect(ids(stoppedBefore(settled(true, true), refund, { relations }))).toEqual(['staff', 'other']);
  });

  it('is not named where it entered', () => {
    expect(ids(stoppedBefore(settled(true, true), { file: 'src/cart/total.ts', line: 2 }, { relations })))
      .toEqual(['other']);
  });

  it('leaves the region unwalked when every case finished, with or without a graph', () => {
    expect(stoppedBefore(settled(false, false), refund, { relations })).toEqual([]);
    expect(stoppedBefore(settled(false, false), refund)).toEqual([]);
  });

  it('cannot tell a hole without the graph once any case stopped', () => {
    expect(anyStopped(settled(true, false))).toBe(true);
    expect(stoppedBefore(settled(true, false), refund)).toBeUndefined();
  });

  it('cannot tell a hole when a case that could have reached it carries no settling', () => {
    expect(stoppedBefore(settled(true, undefined), refund, { relations })).toBeUndefined();
  });

  it('counts a stopped case that crossed the module though the graph missed its import', () => {
    expect(ids(stoppedBefore(settled(true, false), refund, { relations: importers(['test/other.test.ts']) })))
      .toEqual(['staff']);
  });

  it('is carried per range and per changed region', () => {
    const index = settled(true, false);
    const ranges = coveringTestsInFile(index, 'src/cart/total.ts', { relations });
    expect(ranges.map((range) => [range.startLine, ids(range.tests), ids(range.stopped)])).toEqual([
      [1, ['staff', 'guest'], []],
      [6, [], ['staff']],
    ]);
    const [file] = coveringChange(index, new Map([['src/cart/total.ts', [{ start: 7, end: 7 }]]]), { relations });
    expect(ids(file?.regions[0]?.stopped)).toEqual(['staff']);
  });
});
