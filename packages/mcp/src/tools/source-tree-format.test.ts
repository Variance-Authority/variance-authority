import { describe, expect, it } from 'vitest';
import type { FileRecord } from '@variance-authority/core/relate';
import { encodeSourceTree } from './source-tree-format.js';
import { publishedTreeOf } from './tree.js';

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
  it('answers path questions from the published bytes', () => {
    const decoded = publishedTreeOf(encodeSourceTree(records), '/repo');

    expect(decoded.root).toBe('/repo');
    expect([...decoded.files()]).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/lone.ts']);
    expect([...decoded.reachedFrom(['src/a.ts'])]).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect([...decoded.reaching(['src/c.ts'])]).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect([...decoded.distanceFrom(['src/a.ts'])]).toEqual([
      ['src/a.ts', 0],
      ['src/b.ts', 1],
      ['src/c.ts', 2],
    ]);
    expect([...decoded.distanceTo(['src/c.ts'])]).toEqual([
      ['src/a.ts', 2],
      ['src/b.ts', 1],
      ['src/c.ts', 0],
    ]);
    expect(decoded.unknownFiles()).toEqual(['src/c.ts']);
  });

  it('retains a target that has no record of its own', () => {
    const decoded = publishedTreeOf(
      encodeSourceTree([{ file: 'src/a.ts', edges: [{ to: 'src/missing.ts', kind: 'imports' }] }]),
      '/repo',
    );
    expect([...decoded.reachedFrom(['src/a.ts'])]).toEqual(['src/a.ts', 'src/missing.ts']);
  });

  it('accepts paths relative to a workspace inside the graph root', () => {
    const decoded = publishedTreeOf(encodeSourceTree(records), '/repo', '/repo/product');
    expect(decoded.root).toBe('/repo/product');
    expect([...decoded.files()]).toEqual([]);

    const nested = publishedTreeOf(
      encodeSourceTree([
        { file: 'product/src/a.ts', edges: [{ to: 'shared/b.ts', kind: 'imports' }] },
        { file: 'shared/b.ts' },
      ]),
      '/repo',
      '/repo/product',
    );
    expect([...nested.files()]).toEqual(['src/a.ts']);
    expect([...nested.reachedFrom(['src/a.ts'])]).toEqual(['product/src/a.ts', 'shared/b.ts']);
  });
});
