import { describe, expect, it } from 'vitest';
import type { CoveringRegion, CoveringTest } from '@variance-authority/sense/test-selection';
import { editOf, regionsOf, removedText } from './review-region.js';

/** `spill` leaves `src/old.ts` and is written into `src/caps.ts` under `cap`. */
const MOVED = [
  'diff --git a/src/old.ts b/src/old.ts',
  '--- a/src/old.ts',
  '+++ b/src/old.ts',
  '@@ -1,5 +1,1 @@',
  ' export const keep = 1;',
  '-export function spill(level: number): number {',
  '-  return level - 1;',
  '-}',
  '-',
  'diff --git a/src/caps.ts b/src/caps.ts',
  '--- a/src/caps.ts',
  '+++ b/src/caps.ts',
  '@@ -1,1 +1,4 @@',
  ' export const cap = 2;',
  '+export function spill(level: number): number {',
  '+  return level - 1;',
  '+}',
  '',
].join('\n');

const CAPS = ['export const cap = 2;', 'export function spill(level: number): number {', '  return level - 1;', '}'];

const test = (id: string, loaded?: true): CoveringTest => ({
  id, file: `${id}.test.ts`, name: id, stopped: false, distance: 0, ...(loaded === undefined ? {} : { loaded }),
});

describe('what kind of edit a changed region is', () => {
  it('keeps the text a diff removed, per file, without the lines that hold no word', () => {
    expect(removedText(MOVED)).toEqual(new Map([
      ['src/old.ts', '\n\0\nexport function spill(level: number): number {\nreturn level - 1;\n'],
    ]));
  });

  it('calls a region moved when every line of it is written and its text left another file', () => {
    expect(editOf({ startLine: 2, endLine: 4 }, [{ start: 2, end: 4 }], CAPS, 'src/caps.ts', removedText(MOVED)))
      .toEqual({ edit: 'moved', movedFrom: 'src/old.ts' });
  });

  it('prefers the file the region is in when the same text left it too', () => {
    const removed = new Map([...removedText(MOVED), ['src/caps.ts', '\nexport function spill(level: number): number {\nreturn level - 1;\n']]);
    expect(editOf({ startLine: 2, endLine: 4 }, [{ start: 2, end: 4 }], CAPS, 'src/caps.ts', removed))
      .toEqual({ edit: 'moved', movedFrom: 'src/caps.ts' });
  });

  it('calls a region new when its text left nowhere, and when one line of words is all it is', () => {
    expect(editOf({ startLine: 2, endLine: 4 }, [{ start: 2, end: 4 }], CAPS, 'src/caps.ts', new Map())).toEqual({ edit: 'new' });
    expect(editOf({ startLine: 3, endLine: 4 }, [{ start: 3, end: 4 }], CAPS, 'src/caps.ts', removedText(MOVED))).toEqual({ edit: 'new' });
  });

  it('calls a region modified when a line of words in it was not written', () => {
    expect(editOf({ startLine: 1, endLine: 4 }, [{ start: 2, end: 4 }], CAPS, 'src/caps.ts', removedText(MOVED))).toEqual({ edit: 'modified' });
  });

  it('reads every line of the span as words when the tree text is not there', () => {
    expect(editOf({ startLine: 2, endLine: 4 }, [{ start: 2, end: 4 }], undefined, 'src/caps.ts', new Map())).toEqual({ edit: 'new' });
    expect(editOf({ startLine: 2, endLine: 4 }, [{ start: 3, end: 3 }], undefined, 'src/caps.ts', new Map())).toEqual({ edit: 'modified' });
  });
});

describe('the cases that ran a changed line', () => {
  const region = (name: string, startLine: number, endLine: number, tests: readonly CoveringTest[]): CoveringRegion =>
    ({ kind: name === 'cap' ? 'function' : 'branch', name, startLine, endLine, tests });

  it('counts the cases of the innermost region holding each changed line, not every case that entered the function', () => {
    const regions = [
      region('cap', 1, 10, [test('a'), test('b'), test('c'), test('l', true)]),
      region('if', 3, 4, [test('a')]),
      region('else', 6, 7, [test('b'), test('l', true)]),
    ];
    const [cap, then, otherwise] = regionsOf(regions, undefined, [{ start: 4, end: 4 }, { start: 6, end: 6 }], undefined, 'src/caps.ts', new Map());

    expect(cap).toMatchObject({ cases: 3, changedLineCases: 2, edit: 'modified' });
    expect(then).toMatchObject({ cases: 1, changedLineCases: 1 });
    expect(otherwise).toMatchObject({ cases: 1, changedLineCases: 1 });
  });
});
