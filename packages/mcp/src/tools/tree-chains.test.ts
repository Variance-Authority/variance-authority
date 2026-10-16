import { describe, expect, it } from 'vitest';
import type { EdgeKind, FileRecord } from '@variance-authority/core/relate';
import { treeAtWorkspace, treeOf } from './tree.js';

/**
 * The walk against the imports, with the evidence for each file it reached.
 *
 * `c.ts` reaches the subject two ways at the same depth, so the chain is one
 * of two shortest and must be the same one on every call. `d.ts` reaches it
 * only through a type import, which is walked and said.
 */

const reads = (file: string, ...to: readonly (string | readonly [string, EdgeKind])[]): FileRecord => ({
  file,
  edges: to.map((edge) => (typeof edge === 'string' ? { to: edge, kind: 'imports' as const } : { to: edge[0], kind: edge[1] })),
});

const RECORDS: readonly FileRecord[] = [
  reads('src/subject.ts'),
  reads('src/a.ts', 'src/subject.ts'),
  reads('src/b.ts', ['src/subject.ts', 'type']),
  reads('src/c.ts', 'src/a.ts', 'src/b.ts'),
  reads('src/d.ts', 'src/b.ts'),
  reads('src/outside.ts'),
];

const tree = treeOf(RECORDS);

describe('chainsTo', () => {
  it('reaches every file that rests on the subject, at its import distance', () => {
    expect([...tree.chainsTo(['src/subject.ts']).distance]).toEqual([
      ['src/a.ts', 1],
      ['src/b.ts', 1],
      ['src/c.ts', 2],
      ['src/d.ts', 2],
      ['src/subject.ts', 0],
    ]);
  });

  it('gives one shortest chain, the reaching file first and the subject last', () => {
    expect(tree.chainsTo(['src/subject.ts']).chain('src/c.ts')).toEqual([
      { file: 'src/c.ts', kind: 'imports' },
      { file: 'src/a.ts', kind: 'imports' },
      { file: 'src/subject.ts' },
    ]);
  });

  it('walks a type import and names it on the step it took', () => {
    expect(tree.chainsTo(['src/subject.ts']).chain('src/d.ts')).toEqual([
      { file: 'src/d.ts', kind: 'imports' },
      { file: 'src/b.ts', kind: 'type' },
      { file: 'src/subject.ts' },
    ]);
  });

  it('has no chain for a file the walk did not reach', () => {
    expect(tree.chainsTo(['src/subject.ts']).chain('src/outside.ts')).toEqual([]);
  });

  it('answers a workspace coordinate the way the root tree does', () => {
    const nested = treeOf(RECORDS.map((record) => ({
      file: `app/${record.file}`,
      edges: (record.edges ?? []).map((edge) => ({ ...edge, to: `app/${edge.to}` })),
    })), '/repo');
    const chains = treeAtWorkspace(nested, '/repo/app').chainsTo(['src/subject.ts']);
    expect(chains.distance.get('app/src/c.ts')).toBe(2);
  });
});
