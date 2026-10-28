import { describe, expect, it } from 'vitest';
import { overwrittenIn, overwrittenOn } from './overwritten.js';
import type { ExecutionCrossing, ExecutionIndex } from './reverse.js';

/**
 * A record cut to a text an edit wrote over `beta`: `alpha doubles` ran in
 * that text and called the module; `beta adds` ran `beta` at the text before
 * the edit, so it is kept on `beta` flagged.
 */
const file = 'src/a.ts';
const tests = [
  { id: 'alpha', file: 'src/a.test.ts', name: 'a > alpha doubles', stopped: false },
  { id: 'beta', file: 'src/a.test.ts', name: 'a > beta adds', stopped: false },
];

function indexWith(beta: readonly ExecutionCrossing[]): ExecutionIndex {
  return {
    tests,
    modules: [{ file, blocks: [
      { kind: 'module', name: file, path: 'module', startLine: 1, endLine: 10, source: true, crossings: [{ test: 0, distance: 0 }, { test: 1, distance: 0 }] },
      { kind: 'function', name: 'alpha', path: 'alpha', startLine: 1, endLine: 3, source: true, crossings: [{ test: 0, distance: 0 }] },
      { kind: 'function', name: 'beta', path: 'beta', startLine: 6, endLine: 10, source: true, crossings: beta },
    ] }],
  };
}

describe('the cases whose run of a place is not known', () => {
  const index = indexWith([{ test: 1, distance: 0, overwritten: true }]);

  it('are the flagged cases on the regions a line lands on, with those regions', () => {
    expect(overwrittenOn(index, { file, line: 8 })).toEqual({
      tests: [tests[1]],
      regions: [{ kind: 'function', name: 'beta', startLine: 6, endLine: 10 }],
    });
    expect(overwrittenOn(index, { file, function: 'beta' })?.tests).toEqual([tests[1]]);
  });

  it('are none on a line whose regions hold no flagged case, and in a file the record has no row for', () => {
    expect(overwrittenOn(index, { file, line: 2 })).toBeUndefined();
    expect(overwrittenOn(index, { file: 'src/b.ts', line: 8 })).toBeUndefined();
  });

  it('leave out a case that called into the place, which is named for it', () => {
    const called = indexWith([{ test: 1, distance: 0, overwritten: true }, { test: 1, distance: 0 }]);
    expect(overwrittenOn(called, { file, line: 8 })).toBeUndefined();
    const blocks = index.modules[0]!.blocks;
    // `beta adds` called the module, so over the whole file it is named, not unknown.
    expect(overwrittenIn(index, blocks)).toBeUndefined();
    expect(overwrittenIn(index, [blocks[2]!])).toEqual([tests[1]]);
  });
});
