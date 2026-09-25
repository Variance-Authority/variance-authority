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
