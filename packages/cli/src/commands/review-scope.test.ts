import { describe, expect, it } from 'vitest';
import { functionsMarkdown, namedList, uncoveredFunctions, uncoveredMarkdown } from './review-scope.js';
import type { Review, ReviewRegion } from './review.js';

const region = (kind: string, name: string, startLine: number, endLine: number, reach: ReviewRegion['reach'], tests: readonly string[] = []): ReviewRegion => ({
  kind,
  name,
  startLine,
  endLine,
  reach,
  written: true,
  cases: tests.length,
  tests: [...new Set(tests)].sort(),
  // Cases a run listened to and that said nothing: what a case arranged is read in review-preconditions.test.ts.
  called: tests.map((file, index) => ({ file, name: `caps > case ${index}`, preconditions: [] })),
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
      '- `src/caps.ts:9` branch in `cap`',
      '- `src/caps.ts:22-25` function `spill`',
      '',
      '</details>',
    ].join('\n'));
  });

  it('says the record holds no case, rather than that no case ran, before the change has run', () => {
    expect(uncoveredMarkdown(review(mixed, 'before'), mark)[1]).toBe('<details><summary>R Where no case in the record: 2 places in 2 functions</summary>');
  });

  it('folds what ran each function by file, then by the functions one set of cases ran, then by title', () => {
    const text = functionsMarkdown(review([
      region('function', 'cap', 3, 20, 'near', ['b.test.ts', 'a.test.ts']),
      region('function', 'trim', 22, 25, 'near', ['b.test.ts', 'a.test.ts']),
      region('function', 'spill', 30, 35, 'near', ['a.test.ts']),
    ]), mark).join('\n');
    expect(text).toBe([
      '',
      '<details><summary>🧪 What ran 3 changed functions — 3 cases in 2 test files</summary>',
      '',
      '<details><summary><code>src/caps.ts</code>: 3 functions</summary>',
      '',
      '<details><summary>G <code>cap</code>, <code>trim</code> — 2 cases in 2 test files</summary>',
      '',
      '`src/caps.ts:3-20`, `src/caps.ts:22-25`',
      '',
      '- `a.test.ts`',
      '  - caps',
      '    - case 1',
      '- `b.test.ts`',
      '  - caps',
      '    - case 0',
      '',
      '</details>',
      '',
      '<details><summary>G <code>spill</code> — 1 case in 1 test file</summary>',
      '',
      '`src/caps.ts:30-35`',
      '',
      '- `a.test.ts`',
      '  - caps',
      '    - case 0',
      '',
      '</details>',
      '',
      '</details>',
      '',
      '</details>',
    ].join('\n'));
  });

  it('says what the record ran, before the change has run', () => {
    expect(functionsMarkdown(review([region('function', 'cap', 3, 20, 'near', ['a.test.ts'])], 'before'), mark)[1])
      .toBe('<details><summary>🧪 What the record ran for 1 changed function — 1 case in 1 test file</summary>');
  });

  it('names thirty cases under a function and counts the rest', () => {
    const text = functionsMarkdown(review([region('function', 'cap', 3, 20, 'near', Array.from({ length: 32 }, () => 'a.test.ts'))]), mark).join('\n');
    expect(text).toContain('    - case 29\n- and 2 more cases');
    expect(text).not.toContain('case 30');
  });

  it('names the cases of every function however many changed', () => {
    const text = functionsMarkdown(review(Array.from({ length: 30 }, (_, index) => region('function', `f${index}`, index * 10 + 1, index * 10 + 5, 'near', [`t${index}.test.ts`]))), mark).join('\n');
    expect(text).toContain('<details><summary>G <code>f29</code> — 1 case in 1 test file</summary>\n\n`src/caps.ts:291-295`\n\n- `t29.test.ts`');
  });

  it('counts the cases alone when the record names none of them', () => {
    const text = functionsMarkdown(review([{ ...region('function', 'cap', 3, 20, 'near'), cases: 2 }]), mark).join('\n');
    expect(text).toContain('<details><summary>G <code>cap</code> — 2 cases</summary>');
  });

  it('writes nothing when no function changed, or none ran', () => {
    expect(functionsMarkdown(review([region('module', '', 1, 40, 'near', ['a.test.ts'])]), mark)).toEqual([]);
    expect(uncoveredMarkdown(review([region('function', 'cap', 3, 20, 'near', ['a.test.ts'])]), mark)).toEqual([]);
  });
});
