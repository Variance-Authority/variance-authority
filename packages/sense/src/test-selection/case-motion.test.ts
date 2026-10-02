import { describe, expect, it } from 'vitest';
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

/** No file changed between the two texts. */
const UNCHANGED = { diff: new Map() };

describe('what a change moved', () => {
  it('names a region nobody walks any more as lost, one fewer case as thinned, and a new walker as gained', () => {
    const base = index([A, B], [block('apply', 1, [0]), block('round', 10, [0, 1]), block('clamp', 20, [])]);
    const now = index([A, B], [block('apply', 5, []), block('round', 14, [1]), block('clamp', 24, [0])]);
    // Four lines written above the first, so every region stands four lower now.
    const diff = new Map([['src/total.ts', [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 4 }]]]);

    const motion = caseMotion(base, now, { diff });

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

    const [region] = caseMotion(base, now, UNCHANGED).regions;

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

    const motion = caseMotion(base, now, UNCHANGED);

    expect(motion.regions).toEqual([]);
    expect(motion.unread).toEqual(['src/unloaded.ts']);
  });

  it('counts calls only, and leaves out the modules it is told to', () => {
    const base = index([A], [block('apply', 1, [0])]);
    const now = index([A], [{ ...block('apply', 1, []), crossings: [{ test: 0, distance: 0, loaded: true }] }]);

    expect(caseMotion(base, now, UNCHANGED).counts.lost).toBe(1);
    expect(caseMotion(base, now, { ...UNCHANGED, exclude: new Set(['src/total.ts']) }).regions).toEqual([]);
  });

  it('reads a sibling whose cases changed on the lines it stands on', () => {
    const base = index([A, B], [block('pick/filter.arg0', 1, [0]), block('pick/filter.arg0', 5, [1])]);
    const now = index([A, B], [block('pick/filter.arg0', 1, [0]), block('pick/filter.arg0', 5, [])]);

    const motion = caseMotion(base, now, UNCHANGED);

    expect(motion.regions.map((region) => [region.startLine, region.motion])).toEqual([[5, 'lost']]);
    expect(motion.renumbered).toEqual([]);
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
