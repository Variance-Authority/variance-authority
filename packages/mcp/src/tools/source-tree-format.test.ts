import { describe, expect, it } from 'vitest';
import type { FileRecord } from '@variance-authority/core/relate';
import { DOWN, SIDEWAYS } from './hops.js';
import { decodeSourceTree, encodeSourceTree } from './source-tree-format.js';

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
  it('answers reach, distance, hops and chains over the records it encoded', () => {
    const decoded = decodeSourceTree(encodeSourceTree(records), '/repo');

    expect(decoded.root).toBe('/repo');
    expect([...decoded.files]).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/lone.ts']);
    expect([...decoded.reachedFrom(['src/a.ts'])]).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect([...decoded.reaching(['src/c.ts'])]).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect([...decoded.distanceFrom(['src/a.ts'])]).toEqual([['src/a.ts', 0], ['src/b.ts', 1], ['src/c.ts', 2]]);
    expect([...decoded.distanceTo(['src/c.ts'])]).toEqual([['src/a.ts', 2], ['src/b.ts', 1], ['src/c.ts', 0]]);
    expect(decoded.unknownAmong(decoded.files)).toEqual(['src/c.ts']);
    expect([...decoded.hopsFrom(['src/a.ts'])]).toEqual([['src/a.ts', 0], ['src/b.ts', DOWN], ['src/c.ts', 2 * DOWN]]);
    expect([...decoded.hopsTo(['src/c.ts'])]).toEqual([['src/c.ts', 0], ['src/b.ts', DOWN], ['src/a.ts', 2 * DOWN]]);
    expect(decoded.chainsTo(['src/c.ts']).chain('src/a.ts')).toEqual([
      { file: 'src/a.ts', kind: 'imports' },
      { file: 'src/b.ts', kind: 'dynamic' },
      { file: 'src/c.ts' },
    ]);
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
  const native = decodeSourceTree(encodeSourceTree(records), '/repo');
  // The `import()` beside the type import is what makes `one.ts` one hop down; a type edge alone carries no hop.
  expect(Object.fromEntries(native.hopsFrom(['area/start.ts']))).toEqual({
    'area/start.ts': 0,
    'area/one.ts': DOWN,
    'other/bridge.ts': SIDEWAYS,
    'area/deep/two.ts': 2 * DOWN,
    'other/final.ts': SIDEWAYS + DOWN,
  });
  expect(Object.fromEntries(native.hopsTo(['other/final.ts']))).toEqual({
    'other/final.ts': 0,
    'other/bridge.ts': DOWN,
    'area/deep/two.ts': SIDEWAYS,
    'area/start.ts': SIDEWAYS + DOWN,
    'area/one.ts': SIDEWAYS + DOWN,
  });
  expect(native.chainsTo(['area/one.ts']).chain('area/start.ts')).toEqual([{ file: 'area/start.ts', kind: 'dynamic' }, { file: 'area/one.ts' }]);
});
