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

  it('reads a region no shared region encloses at one region spanning the file', () => {
    const outer = { kind: 'function', name: 'outer', path: 'outer', startLine: 2, endLine: 10, source: true } as const;
    const shard = (id: string, endLine: number, distance: number): ExecutionIndex => ({
      tests: [{ id, file: `${id}.test.ts`, name: id }],
      modules: [{
        file: 'src/subject.ts',
        blocks: [
          { kind: 'module', name: '', path: '', startLine: 1, endLine, source: true, crossings: [{ test: 0, distance }] },
          { ...outer, crossings: [] },
        ],
      }],
    });
    const merged = mergeExecutionIndexes([shard('short', 20, 0), shard('long', 22, 1)]);
    expect(merged).toEqual(mergeExecutionIndexes([shard('long', 22, 1), shard('short', 20, 0)]));
    expect(merged.modules[0]!.blocks).toEqual([
      { ...outer, crossings: [] },
      {
        kind: 'module', name: '', path: '', startLine: 1, endLine: 22, source: true,
        crossings: [{ test: 0, distance: 1 }, { test: 1, distance: 0 }],
      },
    ]);
  });

  it('keeps what every run of a case named, so two runs that disagree at one level read as a contradiction', () => {
    const run = (preconditions?: ExecutionIndex['tests'][number]['preconditions']): ExecutionIndex => ({
      tests: [{ id: 'alpha', file: 'alpha.test.ts', name: 'alpha', ...(preconditions === undefined ? {} : { preconditions }) }],
      modules: [],
    });
    const on = { name: 'flag', value: 'ff-on', site: 'alpha.test.ts:3', level: 0xffff };
    const off = { name: 'flag', value: 'ff-off', site: 'alpha.test.ts:3', level: 0xffff };
    const mocked = { name: 'network', value: 'mocked', site: 'alpha.test.ts:2', level: 1 };

    expect(mergeExecutionIndexes([run([on, mocked]), run([mocked, on])]).tests[0]!.preconditions).toEqual([on, mocked]);
    expect(mergeExecutionIndexes([run([on]), run([off])]).tests[0]!.preconditions).toEqual([off, on]);
    expect(mergeExecutionIndexes([run(), run([on])]).tests[0]!.preconditions).toEqual([on]);
    expect(mergeExecutionIndexes([run([]), run()]).tests[0]!.preconditions).toEqual([]);
    expect('preconditions' in mergeExecutionIndexes([run(), run()]).tests[0]!).toBe(false);
  });

  it('lets the body one shard heard override the beforeEach another shard heard, as one run of the case does', () => {
    const run = (preconditions: NonNullable<ExecutionIndex['tests'][number]['preconditions']>): ExecutionIndex => ({
      tests: [{ id: 'alpha', file: 'alpha.test.ts', name: 'alpha', preconditions }],
      modules: [],
    });
    // A retry whose beforeEach threw never reached the body: its shard heard
    // only the beforeEach.
    const live = { name: 'network', value: 'live', site: 'alpha.test.ts:2', level: 0 };
    const recorded = { name: 'network', value: 'recorded', site: 'alpha.test.ts:9', level: 0xffff };
    expect(mergeExecutionIndexes([run([live]), run([recorded])]).tests[0]!.preconditions).toEqual([recorded]);
    expect(mergeExecutionIndexes([run([recorded]), run([live])]).tests[0]!.preconditions).toEqual([recorded]);
  });
});
