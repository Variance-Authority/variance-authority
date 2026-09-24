import { describe, expect, it } from 'vitest';
import { backThrough, hunksOf, placeThrough } from './placed.js';
import { stateOf } from './range-state.js';
import type { CoveringTest, ExecutionTest } from './reverse.js';

// `git diff --no-index -U0` over a ten-line text: two lines inserted after 2,
// line 5 rewritten as two, lines 8-9 removed.
const DIFF = [
  'diff --git a/recorded b/held',
  '--- a/recorded',
  '+++ b/held',
  '@@ -2,0 +3,2 @@ one',
  '+a',
  '+b',
  '@@ -5 +7,2 @@ four',
  '-five',
  '+five',
  '+more',
  '@@ -8,2 +10,0 @@ seven',
  '-eight',
  '-nine',
  '',
].join('\n');
const hunks = hunksOf(DIFF);
const at = (startLine: number, endLine: number) => placeThrough(hunks, { startLine, endLine });

describe('a recorded range in the text an editor holds', () => {
  it('reads every hunk header, with a count of one where git leaves it out', () => {
    expect(hunks).toEqual([
      { oldStart: 2, oldCount: 0, newStart: 3, newCount: 2 },
      { oldStart: 5, oldCount: 1, newStart: 7, newCount: 2 },
      { oldStart: 8, oldCount: 2, newStart: 10, newCount: 0 },
    ]);
  });

  it('shifts a range no hunk touched by what came before it', () => {
    expect(at(1, 2)).toEqual({ lines: { startLine: 1, endLine: 2 }, moved: false });
    expect(at(3, 4)).toEqual({ lines: { startLine: 5, endLine: 6 }, moved: false });
    expect(at(10, 10)).toEqual({ lines: { startLine: 11, endLine: 11 }, moved: false });
  });

  it('marks a range an edit rewrote, spanning the lines it holds now', () => {
    expect(at(4, 6)).toEqual({ lines: { startLine: 6, endLine: 9 }, moved: true });
    expect(at(5, 5)).toEqual({ lines: { startLine: 7, endLine: 8 }, moved: true });
  });

  it('marks a range lines were inserted into', () => {
    expect(at(1, 3)).toEqual({ lines: { startLine: 1, endLine: 5 }, moved: true });
  });

  it('drops a range whose every line was removed', () => {
    expect(at(8, 9)).toBeUndefined();
  });

  it('finds the recorded line a held line was, and none for a line an edit wrote', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((line) => backThrough(hunks, line)))
      .toEqual([1, 2, undefined, undefined, 3, 4, undefined, undefined, 6, 7, 10]);
  });
});

const called = (id: string): CoveringTest => ({ id, file: 't.test.ts', name: id, distance: 0 });
const carried = (id: string): CoveringTest => ({ ...called(id), loaded: true });
const stopped: ExecutionTest = { id: 's', file: 't.test.ts', name: 's', stopped: true };
const range = (tests: readonly CoveringTest[], short?: readonly ExecutionTest[], loaded?: true) => ({
  startLine: 1,
  endLine: 2,
  tests,
  ...(short === undefined ? {} : { stopped: short }),
  ...(loaded === undefined ? {} : { loaded }),
});

describe('the one state a range is painted as', () => {
  it('is walked for two callers, whatever stopped', () => {
    expect(stateOf(range([called('a'), called('b')]))).toBe('walked');
  });

  it('is alone for one caller only when every case that could have reached it finished', () => {
    expect(stateOf(range([called('a')], []))).toBe('alone');
    expect(stateOf(range([called('a')], [stopped]))).toBe('walked');
    expect(stateOf(range([called('a')]))).toBeUndefined();
  });

  it('is loaded when the only entry was while the module evaluated', () => {
    expect(stateOf(range([carried('a')], []))).toBe('loaded');
    expect(stateOf(range([], undefined, true))).toBe('loaded');
  });

  it('tells a hole from an unwalked range, and says neither when it cannot', () => {
    expect(stateOf(range([], [stopped]))).toBe('hole');
    expect(stateOf(range([], []))).toBe('unwalked');
    expect(stateOf(range([]))).toBeUndefined();
  });
});
