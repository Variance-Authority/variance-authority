import { describe, expect, it } from 'vitest';
import type { ModuleId } from '../instrument/index.js';
import {
  AMBIENT,
  type CaseJournal,
  countCrossings,
  executionIndexFrom,
  packCase,
  packFrames,
  unpackCase,
  unpackFrames,
} from './cases.js';
import type { CapturedModule } from './instrumented-modules.js';
import { coveringTests } from './reverse.js';

function captured(file: string, id: ModuleId, lines: readonly [number, number][]): CapturedModule {
  return {
    file,
    id,
    sourceDigest: 'digest',
    instrumented: true,
    blocks: lines.map(([startLine, endLine], ordinal) => ({
      ordinal,
      kind: ordinal === 0 ? 'module' : 'branch',
      digest: `block-${ordinal}`,
      name: ordinal === 0 ? '' : 'decide',
      path: 'decide',
      startLine,
      endLine,
      source: true,
      testFiles: [],
    })),
  };
}

const inventory = new Map<ModuleId, CapturedModule>([
  [7, captured('src/decide.ts', 7, [[1, 9], [2, 4], [5, 7]])],
]);

function journal(file: string, name: string, id: string, hits: number[], shared: number[] = []): CaseJournal {
  return { file, name, id, modules: [{ id: 7, hits, shared }] };
}

describe('a case coordinate', () => {
  it('survives the one string a journal frame names itself with', () => {
    const packed = packCase('test/branch.case.ts', 'decide > takes alpha', '3_1');
    expect(unpackCase(packed)).toEqual({
      file: 'test/branch.case.ts',
      name: 'decide > takes alpha',
      id: '3_1',
    });
  });

  it('reads a bare file path as the bucket no case owns', () => {
    expect(unpackCase('test/branch.case.ts')).toEqual({
      file: 'test/branch.case.ts',
      name: AMBIENT,
      id: AMBIENT,
    });
  });
});

describe('case frames in one file', () => {
  it('come back as the frames that went in', () => {
    const frames = [Uint8Array.of(1, 2, 3), Uint8Array.of(), Uint8Array.of(9)];

    expect(unpackFrames(packFrames(frames)).map((frame) => [...frame])).toEqual([[1, 2, 3], [], [9]]);
  });

  it('refuse a tail that never arrived rather than guess where it ended', () => {
    const packed = packFrames([Uint8Array.of(1, 2, 3, 4, 5)]);

    expect(() => unpackFrames(packed.subarray(0, 6))).toThrow('case journal');
  });
});

describe('folding case frames into an execution index', () => {
  it('separates two cases in one file that entered different branches', () => {
    const index = executionIndexFrom([
      journal('test/branch.case.ts', 'takes alpha', '1_0', [0, 1]),
      journal('test/branch.case.ts', 'takes gamma', '1_1', [0, 2]),
    ], inventory);

    expect(coveringTests(index, { file: 'src/decide.ts', line: 3 }).map((test) => test.name))
      .toEqual(['takes alpha']);
    expect(coveringTests(index, { file: 'src/decide.ts', line: 6 }).map((test) => test.name))
      .toEqual(['takes gamma']);
  });

  it('gives what no case owns to every case in that file, and to no other file', () => {
    const index = executionIndexFrom([
      journal('test/branch.case.ts', 'takes alpha', '1_0', [1]),
      journal('test/branch.case.ts', 'takes gamma', '1_1', [2]),
      journal('test/other.case.ts', 'elsewhere', '2_0', [1]),
      // Module evaluation and `beforeEach` run outside every case scope.
      journal('test/branch.case.ts', AMBIENT, AMBIENT, [0]),
    ], inventory);

    expect(coveringTests(index, { file: 'src/decide.ts', line: 1 }).map((test) => test.id)).toEqual([
      'test/branch.case.ts > takes alpha',
      'test/branch.case.ts > takes gamma',
    ]);
  });

  it('marks a region only a load reached, and unmarks it for a case that entered it', () => {
    const index = executionIndexFrom([
      journal('test/branch.case.ts', 'never calls in', '1_0', []),
      journal('test/branch.case.ts', 'calls in', '1_1', [1]),
      journal('test/branch.case.ts', AMBIENT, AMBIENT, [1], [1]),
    ], inventory);

    const crossings = index.modules[0]?.blocks[1]?.crossings;
    expect(crossings?.map((crossing) => [index.tests[crossing.test]?.name, crossing.loaded])).toEqual([
      ['calls in', undefined],
      ['never calls in', true],
    ]);
  });

  it('distinguishes two cases a file gave the same name', () => {
    const index = executionIndexFrom([
      journal('test/branch.case.ts', 'same', 'a', [1]),
      journal('test/branch.case.ts', 'same', 'b', [2]),
    ], inventory);

    expect(index.tests.map((test) => test.id)).toEqual([
      'test/branch.case.ts > same',
      'test/branch.case.ts > same#1',
    ]);
  });

  it('reads the same however the frames landed on disk', () => {
    const frames = [
      journal('b/two.case.ts', 'beta', '2', [2]),
      journal('a/one.case.ts', 'alpha', '1', [1]),
    ];

    expect(executionIndexFrom(frames, inventory))
      .toEqual(executionIndexFrom([...frames].reverse(), inventory));
  });

  it('counts one crossing per case and region, which is the number that grows', () => {
    const index = executionIndexFrom([
      journal('test/branch.case.ts', 'takes alpha', '1_0', [0, 1]),
      journal('test/branch.case.ts', 'takes gamma', '1_1', [0, 2]),
    ], inventory);

    expect(countCrossings(index)).toBe(4);
  });

  it('leaves out a module no case entered', () => {
    expect(executionIndexFrom([], inventory).modules).toEqual([]);
  });
});
