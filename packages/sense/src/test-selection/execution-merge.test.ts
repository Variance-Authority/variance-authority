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

  it('refuses artifacts whose region inventories disagree', () => {
    const incompatible: ExecutionIndex = {
      ...beta,
      modules: [{
        ...beta.modules[0]!,
        blocks: [{ ...beta.modules[0]!.blocks[0]!, endLine: 4 }],
      }],
    };
    expect(() => mergeExecutionIndexes([alpha, incompatible])).toThrow(/incompatible region inventories/);
  });
});
