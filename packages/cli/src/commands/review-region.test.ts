import { describe, expect, it } from 'vitest';
import {
  coveringChange,
  coveringTests,
  coveringTestsInFile,
  type CoveringTest,
  type ExecutionBlock,
  type ExecutionIndex,
} from '@variance-authority/sense/test-selection';
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
    const removed = removedText(MOVED);
    expect(removed.texts).toEqual(new Map([
      ['src/old.ts', '\n\0\nexport function spill(level: number): number {\nreturn level - 1;\n'],
    ]));
    expect(removed.holders.get('return level - 1;')).toEqual(['src/old.ts']);
  });

  it('calls a region moved when every line of it is written and its text left another file', () => {
    expect(editOf({ startLine: 2, endLine: 4 }, [{ start: 2, end: 4 }], CAPS, 'src/caps.ts', removedText(MOVED)))
      .toEqual({ edit: 'moved', movedFrom: 'src/old.ts' });
  });

  it('prefers the file the region is in when the same text left it too', () => {
    const removed = removedText(`${MOVED}${['diff --git a/src/caps.ts b/src/caps.ts', '--- a/src/caps.ts', '+++ b/src/caps.ts', '@@ -9,2 +9,0 @@', '-export function spill(level: number): number {', '-  return level - 1;', ''].join('\n')}`);
    expect(editOf({ startLine: 2, endLine: 4 }, [{ start: 2, end: 4 }], CAPS, 'src/caps.ts', removed))
      .toEqual({ edit: 'moved', movedFrom: 'src/caps.ts' });
  });

  it('calls a region new when its text left nowhere, and when one line of words is all it is', () => {
    expect(editOf({ startLine: 2, endLine: 4 }, [{ start: 2, end: 4 }], CAPS, 'src/caps.ts', removedText(''))).toEqual({ edit: 'new' });
    expect(editOf({ startLine: 3, endLine: 4 }, [{ start: 3, end: 4 }], CAPS, 'src/caps.ts', removedText(MOVED))).toEqual({ edit: 'new' });
  });

  it('calls a region modified when a line of words in it was not written', () => {
    expect(editOf({ startLine: 1, endLine: 4 }, [{ start: 2, end: 4 }], CAPS, 'src/caps.ts', removedText(MOVED))).toEqual({ edit: 'modified' });
  });

  it('reads every line of the span as words when the tree text is not there', () => {
    expect(editOf({ startLine: 2, endLine: 4 }, [{ start: 2, end: 4 }], undefined, 'src/caps.ts', removedText(''))).toEqual({ edit: 'new' });
    expect(editOf({ startLine: 2, endLine: 4 }, [{ start: 3, end: 3 }], undefined, 'src/caps.ts', removedText(''))).toEqual({ edit: 'modified' });
  });
});

describe('the cases that ran a changed line', () => {
  // `cap` holds an `if` on lines 3-4 and an `else` on lines 6-7: a calls the
  // first branch, b the second, c returns before either.
  const cases = ['a', 'b', 'c'].map((id) => ({ id, file: `${id}.test.ts`, name: id, stopped: false }));
  const block = (kind: string, name: string, startLine: number, endLine: number, tests: readonly number[]): ExecutionBlock =>
    ({ kind, name, path: name, startLine, endLine, source: true, crossings: tests.map((at) => ({ test: at, distance: 0 })) });
  const index: ExecutionIndex = {
    tests: cases,
    modules: [{ file: 'src/caps.ts', blocks: [block('function', 'cap', 1, 10, [0, 1, 2]), block('branch', 'if', 3, 4, [0]), block('branch', 'else', 6, 7, [1])] }],
  };
  const [file] = coveringChange(index, new Map([['src/caps.ts', [{ start: 4, end: 4 }]]]));
  const ran = coveringTestsInFile(index, 'src/caps.ts');

  it('counts the cases `variance covering --line` names for each changed line, not every case that entered the function', () => {
    const [cap, then] = regionsOf(file!.regions, undefined, [{ start: 4, end: 4 }], undefined, 'src/caps.ts', removedText(''), ran);

    expect(cap).toMatchObject({ name: 'cap', cases: 3, changedLineCases: coveringTests(index, { file: 'src/caps.ts', line: 4 }).length, edit: 'modified' });
    expect(cap?.changedLineCases).toBe(1);
    expect(then).toMatchObject({ name: 'if', cases: 1, changedLineCases: 1 });
  });

  it('counts nothing in a region for a changed line outside it', () => {
    // `if` spans lines 3-12 and an inner block 4-6 that only a ran; line 15 changed in `cap`, past `if`.
    const nested: ExecutionIndex = {
      tests: cases,
      modules: [{ file: 'src/caps.ts', blocks: [block('function', 'cap', 1, 20, [0, 1]), block('branch', 'if', 3, 12, [0, 1]), block('branch', 'inner', 4, 6, [0])] }],
    };
    const changed = [{ start: 5, end: 5 }, { start: 15, end: 15 }];
    const [regions] = coveringChange(nested, new Map([['src/caps.ts', changed]]));
    const named = regionsOf(regions!.regions, undefined, changed, undefined, 'src/caps.ts', removedText(''), coveringTestsInFile(nested, 'src/caps.ts'));

    expect(named.find((region) => region.name === 'if')?.changedLineCases)
      .toBe(coveringTests(nested, { file: 'src/caps.ts', line: 5 }).length);
  });

  it('leaves out a case named only because its file loaded the module', () => {
    const loaded = [{ startLine: 1, endLine: 10, tests: [test('a'), test('l', true)] }];
    const [cap] = regionsOf(file!.regions, undefined, [{ start: 4, end: 4 }], undefined, 'src/caps.ts', removedText(''), loaded);

    expect(cap?.changedLineCases).toBe(1);
  });
});
