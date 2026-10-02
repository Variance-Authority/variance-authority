import { describe, expect, it } from 'vitest';
import { relationsOfFiles } from '@variance-authority/core/relate';
import { caseMotion } from './case-motion.js';
import type { ExecutionBlock, ExecutionIndex, ExecutionTest } from './reverse.js';

const A = { id: 'a.test.ts > one', file: 'a.test.ts', name: 'one', stopped: false };
const B = { id: 'b.test.ts > two', file: 'b.test.ts', name: 'two', stopped: false };

function block(name: string, startLine: number, tests: readonly number[], kind = 'function'): ExecutionBlock {
  return {
    kind, name, path: 'entry', startLine, endLine: startLine + 3, source: true,
    crossings: tests.map((test) => ({ test, distance: 0 })),
  };
}

function index(tests: readonly ExecutionTest[], blocks: readonly ExecutionBlock[]): ExecutionIndex {
  return { tests, modules: [{ file: 'src/total.ts', blocks }] };
}

describe('what a change moved', () => {
  it('names a region nobody walks any more as lost, one fewer case as thinned, and a new walker as gained', () => {
    const base = index([A, B], [block('apply', 1, [0]), block('round', 10, [0, 1]), block('clamp', 20, [])]);
    const now = index([A, B], [block('apply', 5, []), block('round', 14, [1]), block('clamp', 24, [0])]);

    const motion = caseMotion(base, now);

    expect(motion.regions.map((region) => [region.name, region.motion, region.startLine])).toEqual([
      ['apply', 'lost', 5],
      ['round', 'thinned', 14],
      ['clamp', 'gained', 24],
    ]);
    expect(motion.counts).toEqual({ lost: 1, hidden: 0, thinned: 1, gained: 1 });
    expect(motion.testFiles).toEqual([
      {
        file: 'a.test.ts',
        entered: [expect.objectContaining({ name: 'clamp' })],
        left: [expect.objectContaining({ name: 'apply' }), expect.objectContaining({ name: 'round' })],
      },
    ]);
  });

  it('calls a loss hidden when a case stopped, and does not guess which case without the file graph', () => {
    const base = index([A, B], [block('apply', 1, [0, 1])]);
    const now = index([A, { ...B, stopped: true }], [block('apply', 1, [])]);

    const [region] = caseMotion(base, now).regions;

    expect(region!.motion).toBe('hidden');
    expect(region!.stopped).toBeUndefined();
  });

  it('says nothing of a region only one side holds, and names a module the current record has no row for', () => {
    const base: ExecutionIndex = {
      tests: [A],
      modules: [
        { file: 'src/total.ts', blocks: [block('gone', 1, [0])] },
        { file: 'src/unloaded.ts', blocks: [block('x', 1, [0])] },
      ],
    };
    const now = index([A], [block('gone', 1, [0], 'method'), block('fresh', 9, [0])]);

    const motion = caseMotion(base, now);

    expect(motion.regions).toEqual([]);
    expect(motion.unread).toEqual(['src/unloaded.ts']);
  });

  it('counts calls only, and leaves out the modules it is told to', () => {
    const base = index([A], [block('apply', 1, [0])]);
    const now = index([A], [{ ...block('apply', 1, []), crossings: [{ test: 0, distance: 0, loaded: true }] }]);

    expect(caseMotion(base, now).counts.lost).toBe(1);
    expect(caseMotion(base, now, { exclude: new Set(['src/total.ts']) }).regions).toEqual([]);
  });
});

describe('a region an edit beside it renumbered', () => {
  const C = { id: 'c.test.ts > three', file: 'c.test.ts', name: 'three', stopped: false };

  it('is paired by its cases, not its occurrence, and is named as renumbered rather than lost and gained', () => {
    // The first of three `.filter` callbacks is deleted: by occurrence the second now is the first at the base.
    const base = index([A, B, C], [block('pick/filter.arg0', 1, [0]), block('pick/filter.arg0', 5, [1]), block('pick/filter.arg0', 9, [2])]);
    const now = index([A, B, C], [block('pick/filter.arg0', 5, [1]), block('pick/filter.arg0', 9, [2])]);

    const motion = caseMotion(base, now);

    expect(motion.regions).toEqual([]);
    expect(motion.testFiles).toEqual([]);
    expect(motion.renumbered.map((region) => region.startLine)).toEqual([5, 9]);
  });

  it('still reads a sibling whose cases changed by its address', () => {
    const base = index([A, B], [block('pick/filter.arg0', 1, [0]), block('pick/filter.arg0', 5, [1])]);
    const now = index([A, B], [block('pick/filter.arg0', 1, [0]), block('pick/filter.arg0', 5, [])]);

    const motion = caseMotion(base, now);

    expect(motion.regions.map((region) => [region.startLine, region.motion])).toEqual([[5, 'lost']]);
    expect(motion.renumbered).toEqual([]);
  });
});

describe('a region nobody walks any more, read with the file graph', () => {
  // `a.test.ts` imports `src/total.ts`; `b.test.ts` imports nothing of it.
  const relations = relationsOfFiles([
    { file: 'src/total.ts' },
    { file: 'a.test.ts', edges: [{ to: 'src/total.ts', kind: 'imports' as const }] },
    { file: 'b.test.ts' },
  ]);

  it('is hidden, and names the stopped cases whose files import it as the ones that could have reached it', () => {
    const base = index([A, B], [block('apply', 1, [0])]);
    const now = index([{ ...A, stopped: true }, B], [block('apply', 1, [])]);

    const [region] = caseMotion(base, now, { relations }).regions;

    expect(region!.motion).toBe('hidden');
    expect(region!.stopped?.map((test) => test.id)).toEqual([A.id]);
  });

  it('is lost when the only case that stopped imports nothing of it', () => {
    const base = index([A, B], [block('apply', 1, [0])]);
    const now = index([A, { ...B, stopped: true }], [block('apply', 1, [])]);

    const [region] = caseMotion(base, now, { relations }).regions;

    expect(region!.motion).toBe('lost');
    expect(region!.stopped).toBeUndefined();
  });

  it('is hidden, naming no case, when no test file imports it at all', () => {
    // The graph holds `src/total.ts`, so it can answer, and its answer is that no test file loads it.
    const unimported = relationsOfFiles([{ file: 'src/total.ts' }, { file: 'a.test.ts' }, { file: 'b.test.ts' }]);
    const base = index([A, B], [block('apply', 1, [0])]);
    const now = index([A, { ...B, stopped: true }], [block('apply', 1, [])]);

    const [region] = caseMotion(base, now, { relations: unimported }).regions;

    expect(region!.motion).toBe('hidden');
    expect(region!.stopped).toBeUndefined();
  });
});

describe('a region paired through the diff from the base', () => {
  // Lines 1-4 are removed, so every line after them is numbered four lower now.
  const diff = new Map([['src/total.ts', [{ oldStart: 1, oldCount: 4, newStart: 0, newCount: 0 }]]]);

  it('is named as renumbered when its lines pair it with a row its occurrence does not', () => {
    // The first of three `.filter` callbacks is deleted. The callback now on line 1 is run by `a`'s case, which ran
    // the deleted one: by occurrence or by cases it is the deleted one's, by its lines it is the second's.
    const base = index([A, B], [block('pick/filter.arg0', 1, [0]), block('pick/filter.arg0', 5, [1]), block('pick/filter.arg0', 9, [1])]);
    const now = index([A, B], [block('pick/filter.arg0', 1, [0]), block('pick/filter.arg0', 5, [1])]);

    const motion = caseMotion(base, now, { diff });

    expect(motion.regions).toEqual([]);
    expect(motion.testFiles).toEqual([
      { file: 'a.test.ts', entered: [expect.objectContaining({ startLine: 1 })], left: [] },
      { file: 'b.test.ts', entered: [], left: [expect.objectContaining({ startLine: 1 })] },
    ]);
    expect(motion.renumbered.map((region) => region.startLine)).toEqual([1, 5]);
  });

  it('pairs no row with a region the build wrote and the source does not hold', () => {
    const base = index([A], [block('helper', 5, [0])]);
    const now = index([A], [{ ...block('helper', 1, []), source: false }]);

    const motion = caseMotion(base, now, { diff });

    expect(motion.regions).toEqual([]);
  });
});
