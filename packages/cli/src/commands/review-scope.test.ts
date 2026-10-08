import { describe, expect, it } from 'vitest';
import { functionsMarkdown, namedList, uncoveredFunctions, uncoveredMarkdown } from './review-scope.js';
import type { Review, ReviewRegion } from './review.js';

const region = (kind: string, name: string, startLine: number, endLine: number, reach: ReviewRegion['reach'], tests: readonly string[] = []): ReviewRegion => ({
  kind,
  name,
  startLine,
  endLine,
  reach,
  edit: 'new',
  cases: tests.length,
  changedLineCases: tests.length,
  tests: [...new Set(tests)].sort(),
  // Cases a run listened to and that said nothing: what a case arranged is read in review-preconditions.test.ts.
  called: tests.map((file, index) => ({ id: `${file} > caps > case ${index}`, file, name: `caps > case ${index}`, preconditions: [] })),
});

const review = (regions: readonly ReviewRegion[], record: Review['record'] = 'ran'): Review =>
  ({ from: 'abc', record, base: 'since', files: [{ file: 'src/caps.ts', regions }] }) as unknown as Review;

const mark = (value: ReviewRegion): string => (value.reach === 'near' ? 'G' : 'R');

const mixed = [
  region('module', '', 1, 40, 'near', ['a.test.ts']),
  region('function', 'cap', 3, 20, 'near', ['b.test.ts', 'a.test.ts']),
  region('function', 'cap/map.arg0', 5, 5, 'near', ['a.test.ts']),
  region('branch', 'cap', 9, 9, 'unwalked'),
  region('function', 'spill', 22, 25, 'unwalked'),
];

describe('where to look, for a comment', () => {
  it('names the changed functions holding code no case ran, a branch by the function around it', () => {
    expect(uncoveredFunctions(review(mixed))).toEqual({ total: 2, names: ['cap', 'spill'] });
  });

  it('names five functions and counts the rest', () => {
    expect(namedList(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('`a`, `b`, `c`, `d`, `e` and 2 more');
  });

  it('folds each location no case ran under how many there are', () => {
    expect(uncoveredMarkdown(review(mixed), mark).join('\n')).toBe([
      '',
      '<details><summary>R Where no case ran: 2 places in 2 functions</summary>',
      '',
      '- `src/caps.ts:9` branch in `cap` (new)',
      '- `src/caps.ts:22-25` function `spill` (new)',
      '',
      '</details>',
    ].join('\n'));
  });

  it('says the record holds no case, rather than that no case ran, before the change has run', () => {
    expect(uncoveredMarkdown(review(mixed, 'before'), mark)[1]).toBe('<details><summary>R Where no case in the record: 2 places in 2 functions</summary>');
  });

  it('maps each changed function to the tests that ran it, one row a function', () => {
    const text = functionsMarkdown(review([
      region('function', 'cap', 3, 20, 'near', ['b.test.ts', 'a.test.ts']),
      { ...region('function', 'trim', 22, 25, 'far', ['c.test.ts', 'a.test.ts', 'b.test.ts', 'd.test.ts']), edit: 'modified', changedLineCases: 1 },
      { ...region('function', 'spill', 30, 35, 'near', ['a.test.ts']), edit: 'moved', movedFrom: 'src/old.ts' },
    ]), mark).join('\n');
    expect(text).toBe([
      '',
      '<details><summary>🧪 What ran 3 changed functions — 6 cases in 4 test files</summary>',
      '',
      '| | Function | Edit | Where | Cases entered | Ran a changed line | Test files |',
      '|---|---|---|---|--:|--:|---|',
      '| G | `cap` | new | `src/caps.ts:3-20` | 2 | 2 | `a.test.ts`, `b.test.ts` |',
      '| R | `trim` | modified | `src/caps.ts:22-25` | 4 | 1 | `a.test.ts`, `b.test.ts`, `c.test.ts` and 1 more |',
      '| G | `spill` | moved from `src/old.ts` | `src/caps.ts:30-35` | 1 | 1 | `a.test.ts` |',
      '',
      'A case entered a function when it called into it, and ran a changed line when it entered the innermost region holding one. Case titles are in the review\'s JSON.',
      '',
      '</details>',
    ].join('\n'));
  });

  it('says what the record ran, before the change has run', () => {
    expect(functionsMarkdown(review([region('function', 'cap', 3, 20, 'near', ['a.test.ts'])], 'before'), mark)[1])
      .toBe('<details><summary>🧪 What the record ran for 1 changed function — 1 case in 1 test file</summary>');
  });

  it('says a function moved within its own file', () => {
    const text = functionsMarkdown(review([{ ...region('function', 'cap', 3, 20, 'near', ['a.test.ts']), edit: 'moved', movedFrom: 'src/caps.ts' }]), mark).join('\n');
    expect(text).toContain('| G | `cap` | moved within the file | `src/caps.ts:3-20` |');
  });

  it('links each location to the commit the cases ran at, when the review knows where it is kept', () => {
    const linked = { ...review([region('function', 'cap', 3, 20, 'near', ['a.test.ts']), region('function', 'spill', 22, 22, 'unwalked')]), head: { commit: 'e7720ded', parents: [], blob: 'https://github.com/o/r/blob/e7720ded' } } as Review;
    expect(functionsMarkdown(linked, mark).join('\n')).toContain('| [`src/caps.ts:3-20`](https://github.com/o/r/blob/e7720ded/src/caps.ts#L3-L20) |');
    expect(uncoveredMarkdown(linked, mark).join('\n')).toContain('- [`src/caps.ts:22`](https://github.com/o/r/blob/e7720ded/src/caps.ts#L22) function `spill` (new)');
  });

  it('lists a hundred functions and counts the rest', () => {
    const text = functionsMarkdown(review(Array.from({ length: 102 }, (_, index) => region('function', `f${index}`, index * 10 + 1, index * 10 + 5, 'near', [`t${index}.test.ts`]))), mark).join('\n');
    expect(text).toContain('| G | `f99` |');
    expect(text).not.toContain('`f100`');
    expect(text).toContain('2 more functions are in the review\'s JSON.');
  });

  it('counts the cases alone when the record names none of them', () => {
    const text = functionsMarkdown(review([{ ...region('function', 'cap', 3, 20, 'near'), cases: 2, changedLineCases: 2 }]), mark).join('\n');
    expect(text).toContain('| G | `cap` | new | `src/caps.ts:3-20` | 2 | 2 |  |');
  });

  it('writes nothing when no function changed, or none ran', () => {
    expect(functionsMarkdown(review([region('module', '', 1, 40, 'near', ['a.test.ts'])]), mark)).toEqual([]);
    expect(uncoveredMarkdown(review([region('function', 'cap', 3, 20, 'near', ['a.test.ts'])]), mark)).toEqual([]);
  });
});
