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

    const [region] = caseMotion(base, now, { ...UNCHANGED, relations }).regions;

    expect(region!.motion).toBe('hidden');
    expect(region!.stopped?.map((test) => test.id)).toEqual([A.id]);
  });

  it('is lost when the only case that stopped imports nothing of it', () => {
    const base = index([A, B], [block('apply', 1, [0])]);
    const now = index([A, { ...B, stopped: true }], [block('apply', 1, [])]);

    const [region] = caseMotion(base, now, { ...UNCHANGED, relations }).regions;

    expect(region!.motion).toBe('lost');
    expect(region!.stopped).toBeUndefined();
  });

  it('is hidden, naming no case, when no test file imports it at all', () => {
    // The graph holds `src/total.ts`, so it can answer, and its answer is that no test file loads it.
    const unimported = relationsOfFiles([{ file: 'src/total.ts' }, { file: 'a.test.ts' }, { file: 'b.test.ts' }]);
    const base = index([A, B], [block('apply', 1, [0])]);
    const now = index([A, { ...B, stopped: true }], [block('apply', 1, [])]);

    const [region] = caseMotion(base, now, { ...UNCHANGED, relations: unimported }).regions;

    expect(region!.motion).toBe('hidden');
    expect(region!.stopped).toBeUndefined();
  });
});

describe('the cases the comparison left out', () => {
  it('stand at both ends of a region they reach in the cut of the module the current record holds', () => {
    const base = index([A], [block('apply', 1, [0]), block('round', 10, [])]);
    const now = index([A], [block('apply', 1, []), block('round', 10, [0])]);
    const retained = index([B], [block('apply', 1, [0]), block('round', 10, [0])]);

    // `apply` keeps B's case rather than losing every case, and `round` had B's before A reached it.
    expect(caseMotion(base, now, { ...UNCHANGED, retained }).regions.map((region) => [region.name, region.motion])).toEqual([['apply', 'thinned']]);
  });

  it('count a case the base also holds once at each end', () => {
    const base = index([A, B], [block('apply', 1, [0, 1])]);
    const now = index([A, B], [block('apply', 1, [])]);
    const retained = index([A], [block('apply', 1, [0])]);

    expect(caseMotion(base, now, { ...UNCHANGED, retained }).regions.map((region) => [region.name, region.motion, region.before.length])).toEqual([
      ['apply', 'thinned', 2],
    ]);
    expect(caseMotion(index([A], [block('apply', 1, [0])]), index([A], [block('apply', 1, [])]), { ...UNCHANGED, retained }).regions).toEqual([]);
  });

  it('credit nothing in a cut of the module other than the one the current record holds', () => {
    // The retained cut still holds the first of two `.filter` callbacks, which
    // the current record does not: by occurrence, its case would land on the
    // second callback, which no case reaches.
    const base = index([A], [block('pick/filter.arg0', 5, [0])]);
    const now = index([A], [block('pick/filter.arg0', 5, [])]);
    const retained = index([B], [block('pick/filter.arg0', 1, [0]), block('pick/filter.arg0', 5, [])]);

    expect(caseMotion(base, now, { ...UNCHANGED, retained }).regions.map((region) => [region.startLine, region.motion])).toEqual([[5, 'lost']]);
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

  it('credits the cases left out of the comparison to the region its lines paired', () => {
    const base = index([A], [block('apply', 5, [0])]);
    const now = index([A], [block('apply', 1, [])]);
    const retained = index([B], [block('apply', 1, [0])]);

    expect(caseMotion(base, now, { diff }).regions.map((region) => [region.startLine, region.motion])).toEqual([[1, 'lost']]);
    expect(caseMotion(base, now, { diff, retained }).regions.map((region) => [region.startLine, region.motion, region.before.length])).toEqual([
      [1, 'thinned', 2],
    ]);
  });

  it('pairs no row with a region the build wrote and the source does not hold', () => {
    const base = index([A], [block('helper', 5, [0])]);
    const now = index([A], [{ ...block('helper', 1, []), source: false }]);

    const motion = caseMotion(base, now, { diff });

    expect(motion.regions).toEqual([]);
  });
});

describe('a branch whose lines carried it onto a branch of another path', () => {
  // `casesMoved` holds two one-line `if (...) return` branches, and the head text has one line written above it.
  function branch(path: string, line: number, tests: readonly number[]): ExecutionBlock {
    return { ...block('casesMoved', line, tests, 'branch'), path, endLine: line };
  }
  const head = (tests: readonly number[]) =>
    index([A], [{ ...block('casesMoved', 11, []), endLine: 14 }, branch('if#0/then', 12, tests), branch('if#1/then', 13, [])]);

  it('is not paired when no edit could have renumbered it, and is named as mismatched', () => {
    // The base reading stands one line lower than its text: its `if#0/then` claims the line its `if#1/then` is on.
    const base = index([A], [{ ...block('casesMoved', 11, []), endLine: 14 }, branch('if#0/then', 12, [0]), branch('if#1/then', 13, [])]);
    const above = new Map([['src/total.ts', [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1 }]]]);

    const motion = caseMotion(base, head([0]), { diff: above });

    expect(motion.regions).toEqual([]);
    expect(motion.mismatched).toEqual([
      expect.objectContaining({ path: 'if#0/then', startLine: 12, now: expect.objectContaining({ path: 'if#1/then', startLine: 13 }) }),
    ]);
  });

  it('is paired when an edit inside the function before it wrote a sibling that renumbered it', () => {
    const base = index([A], [{ ...block('casesMoved', 10, []), endLine: 13 }, branch('if#0/then', 11, [0])]);
    // A new first branch is written on line 11, so the base `if#0/then` stands on line 12 as `if#1/then`.
    const inside = new Map([['src/total.ts', [{ oldStart: 10, oldCount: 0, newStart: 11, newCount: 1 }]]]);
    const now = index([A], [{ ...block('casesMoved', 10, []), endLine: 14 }, branch('if#0/then', 11, []), branch('if#1/then', 12, [])]);

    const motion = caseMotion(base, now, { diff: inside });

    expect(motion.regions.map((region) => [region.startLine, region.motion])).toEqual([[12, 'lost']]);
    expect(motion.mismatched).toEqual([]);
  });
});

// Without the diff — a base whose commit is unknown or not in the clone — a sibling written before another whose
// cases also changed takes that one's occurrence: the address pairs the displaced row with the new region (lost) and
// the next row with the displaced region (gained). `coverage-sibling.test.ts` shows the diff pairing it truly.
it.todo('reports no motion for a sibling neither the diff nor its cases can tell from its neighbour — needs a rule for what an ambiguous occurrence pairing is reported as, without a diff to pair it');
