import { describe, expect, it } from 'vitest';
import type { FileRecord } from '@variance-authority/core/relate';
import { decodeSourceTree, encodeSourceTree } from './source-tree-format.js';
import { treeOf } from './tree.js';

const records: readonly FileRecord[] = [
  { file: 'src/a.ts', edges: [{ to: 'src/b.ts', kind: 'imports' }] },
  {
    file: 'src/b.ts',
    edges: [
      { to: 'src/c.ts', kind: 'dynamic' },
      { to: 'src/c.ts', kind: 'dynamic' },
    ],
  },
  { file: 'src/c.ts', unknown: 'the generated edge could not be read' },
  { file: 'src/lone.ts', edges: [] },
];

describe('published source tree', () => {
  it('answers the same path questions as the record fold', () => {
    const expected = treeOf(records, '/repo');
    const decoded = decodeSourceTree(encodeSourceTree(records), '/repo');

    expect(decoded.root).toBe('/repo');
    expect([...decoded.files]).toEqual([...expected.files]);
    expect([...decoded.reachedFrom(['src/a.ts'])]).toEqual([...expected.reachedFrom(['src/a.ts'])]);
    expect([...decoded.reaching(['src/c.ts'])]).toEqual([...expected.reaching(['src/c.ts'])]);
    expect([...decoded.distanceFrom(['src/a.ts'])]).toEqual([...expected.distanceFrom(['src/a.ts'])]);
    expect([...decoded.distanceTo(['src/c.ts'])]).toEqual([...expected.distanceTo(['src/c.ts'])]);
    expect(decoded.unknownAmong(decoded.files)).toEqual(expected.unknownAmong(expected.files));
    expect([...decoded.hopsFrom(['src/a.ts'])]).toEqual([...expected.hopsFrom(['src/a.ts'])]);
    expect([...decoded.hopsTo(['src/c.ts'])]).toEqual([...expected.hopsTo(['src/c.ts'])]);
    expect(decoded.chainsTo(['src/c.ts']).chain('src/a.ts')).toEqual(expected.chainsTo(['src/c.ts']).chain('src/a.ts'));
  });

  it('retains a target that has no record of its own', () => {
    const decoded = decodeSourceTree(
      encodeSourceTree([{ file: 'src/a.ts', edges: [{ to: 'src/missing.ts', kind: 'imports' }] }]),
      '/repo',
    );
    expect([...decoded.reachedFrom(['src/a.ts'])]).toEqual(['src/a.ts', 'src/missing.ts']);
  });

  it('accepts paths relative to a workspace inside the graph root', () => {
    const decoded = decodeSourceTree(encodeSourceTree(records), '/repo', '/repo/product');
    expect(decoded.root).toBe('/repo/product');
    expect([...decoded.files]).toEqual([]);

    const nested = decodeSourceTree(
      encodeSourceTree([
        { file: 'product/src/a.ts', edges: [{ to: 'shared/b.ts', kind: 'imports' }] },
        { file: 'shared/b.ts' },
      ]),
      '/repo',
      '/repo/product',
    );
    expect([...nested.files]).toEqual(['src/a.ts']);
    expect([...nested.reachedFrom(['src/a.ts'])]).toEqual(['product/src/a.ts', 'shared/b.ts']);
  });
});


it('keeps runtime evidence when a file imports the same target through types and values', () => {
  const records: readonly FileRecord[] = [
    { file: 'area/start.ts', edges: [{ to: 'area/one.ts', kind: 'type' }, { to: 'area/one.ts', kind: 'dynamic' }, { to: 'other/bridge.ts', kind: 'imports' }] },
    { file: 'area/one.ts', edges: [{ to: 'area/deep/two.ts', kind: 'imports' }] },
    { file: 'area/deep/two.ts', edges: [{ to: 'other/final.ts', kind: 'imports' }] },
    { file: 'other/bridge.ts', edges: [{ to: 'other/final.ts', kind: 'imports' }] },
    { file: 'other/final.ts' },
  ];
  const expected = treeOf(records, '/repo');
  const native = decodeSourceTree(encodeSourceTree(records), '/repo');
  expect([...native.hopsFrom(['area/start.ts'])]).toEqual([...expected.hopsFrom(['area/start.ts'])]);
  expect([...native.hopsTo(['other/final.ts'])]).toEqual([...expected.hopsTo(['other/final.ts'])]);
  expect(native.chainsTo(['area/one.ts']).chain('area/start.ts')).toEqual([{ file: 'area/start.ts', kind: 'dynamic' }, { file: 'area/one.ts' }]);
});
