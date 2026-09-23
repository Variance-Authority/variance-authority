import { describe, expect, it } from 'vitest';
import { mergeExecutionIndexes } from './execution-merge.js';
import type { ExecutionIndex } from './reverse.js';

const alpha: ExecutionIndex = {
  tests: [{ id: 'alpha', file: 'alpha.test.ts', name: 'alpha' }],
  modules: [{
    file: 'src/subject.ts',
    blocks: [{
      kind: 'function', name: 'subject', path: 'subject', startLine: 1, endLine: 3, source: true,
      crossings: [{ test: 0, distance: 2, loaded: true }],
    }],
  }],
};

const beta: ExecutionIndex = {
  tests: [
    { id: 'beta', file: 'beta.test.ts', name: 'beta' },
    { id: 'alpha', file: 'alpha.test.ts', name: 'alpha' },
  ],
  modules: [{
    file: 'src/subject.ts',
    blocks: [{
      kind: 'function', name: 'subject', path: 'subject', startLine: 1, endLine: 3, source: true,
      crossings: [
        { test: 0, distance: 0 },
        { test: 1, distance: 1 },
      ],
    }],
  }],
};

describe('mergeExecutionIndexes', () => {
  it('assembles shard artifacts deterministically and unions a repeated test', () => {
    const merged = mergeExecutionIndexes([alpha, beta]);
    expect(merged).toEqual(mergeExecutionIndexes([beta, alpha]));
    expect(merged.tests.map((test) => test.id)).toEqual(['alpha', 'beta']);
    expect(merged.modules[0]!.blocks[0]!.crossings).toEqual([
      { test: 0, distance: 1 },
      { test: 1, distance: 0 },
    ]);
  });

  it('reads a file two shards cut apart at the regions both hold', () => {
    const module = { kind: 'module', name: '', path: '', startLine: 1, endLine: 20, source: true } as const;
    const outer = { kind: 'function', name: 'outer', path: 'outer', startLine: 2, endLine: 10, source: true } as const;
    const inner = { kind: 'function', name: 'inner', path: 'inner', startLine: 12, endLine: 15, source: true } as const;
    const branch = { kind: 'branch', name: '', path: 'outer', startLine: 4, endLine: 6, source: true } as const;
    const plain: ExecutionIndex = {
      tests: [{ id: 'plain', file: 'plain.test.ts', name: 'plain' }],
      modules: [{
        file: 'src/subject.ts',
        blocks: [
          { ...module, crossings: [] },
          { ...outer, crossings: [] },
          { ...inner, crossings: [{ test: 0, distance: 0 }] },
        ],
      }],
    };
    const split: ExecutionIndex = {
      tests: [{ id: 'split', file: 'split.test.ts', name: 'split' }],
      modules: [{
        file: 'src/subject.ts',
        blocks: [
          { ...module, crossings: [] },
          { ...outer, crossings: [] },
          { ...branch, crossings: [{ test: 0, distance: 1 }] },
          { ...inner, crossings: [] },
        ],
      }],
    };
    const merged = mergeExecutionIndexes([plain, split]);
    expect(merged).toEqual(mergeExecutionIndexes([split, plain]));
    expect(merged.modules[0]!.blocks.map(({ name, crossings }) => [name, crossings])).toEqual([
      ['', []],
      ['outer', [{ test: 1, distance: 1 }]],
      ['inner', [{ test: 0, distance: 0 }]],
    ]);
  });
});
