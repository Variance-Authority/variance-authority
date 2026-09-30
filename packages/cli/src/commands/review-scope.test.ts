import { describe, expect, it } from 'vitest';
import { functionsMarkdown, uncoveredCallout } from './review-scope.js';
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
  called: tests.map((file, index) => ({ file, name: `caps > case ${index}` })),
});

const review = (regions: readonly ReviewRegion[], record: Review['record'] = 'ran'): Review =>
  ({ from: 'abc', record, base: 'since', files: [{ file: 'src/caps.ts', regions }] }) as unknown as Review;

const mark = (value: ReviewRegion): string => (value.reach === 'near' ? 'G' : 'R');

describe('where to look, for a comment', () => {
  it('names each uncovered changed region in the callout as a path and line', () => {
    const lines = uncoveredCallout(review([
      region('module', '', 1, 40, 'near', ['a.test.ts']),
      region('function', 'cap', 3, 20, 'near', ['a.test.ts']),
      region('branch', 'cap', 9, 9, 'unwalked'),
      region('function', 'spill', 22, 25, 'unwalked'),
    ]));
    expect(lines).toEqual(['>', '> - `src/caps.ts:9` branch in `cap`, new', '> - `src/caps.ts:22-25` function `spill`, new']);
  });

  it('names no location when every changed region has a case', () => {
    expect(uncoveredCallout(review([region('function', 'cap', 3, 20, 'near', ['a.test.ts'])]))).toEqual([]);
  });

  it('names ten uncovered locations in the callout and counts the rest', () => {
    const lines = uncoveredCallout(review(Array.from({ length: 12 }, (_, index) => region('function', `f${index}`, index * 10 + 1, index * 10 + 5, 'unwalked'))));
    expect(lines).toHaveLength(12);
    expect(lines.at(-1)).toBe('> - and 2 more, below.');
  });

  it('gives each changed function a line, in file order, with its case titles folded under it', () => {
    const text = functionsMarkdown(review([
      region('module', '', 1, 40, 'near', ['a.test.ts']),
      region('function', 'cap', 3, 20, 'near', ['b.test.ts', 'a.test.ts']),
      region('function', 'cap/map.arg0', 5, 5, 'near', ['a.test.ts']),
      region('function', 'spill', 22, 25, 'unwalked'),
    ]), mark).join('\n');
    expect(text).toBe([
      '',
      '**What ran each changed function**',
      '',
      '<details><summary>G <code>src/caps.ts:3-20</code> function <code>cap</code>, new — 2 cases in 2 test files</summary>',
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
      'R `src/caps.ts:22-25` function `spill`, new — no case ran it',
    ].join('\n'));
  });

  it('says a function written since the record was made has not run yet, rather than that no case ran it', () => {
    const text = functionsMarkdown(review([region('function', 'spill', 22, 25, 'unwalked')], 'before'), mark).join('\n');
    expect(text).toContain('**What ran each changed function when the record was made**, so what this change might move');
    expect(text).toContain('R `src/caps.ts:22-25` function `spill`, new — written since the record, so not run yet');
  });

  it('names thirty cases under a function and counts the rest', () => {
    const text = functionsMarkdown(review([region('function', 'cap', 3, 20, 'near', Array.from({ length: 32 }, () => 'a.test.ts'))]), mark).join('\n');
    expect(text).toContain('    - case 29\n- and 2 more cases');
    expect(text).not.toContain('case 30');
  });

  it('folds the changed functions past twenty under one summary', () => {
    const text = functionsMarkdown(review(Array.from({ length: 22 }, (_, index) => region('function', `f${index}`, index * 10 + 1, index * 10 + 5, 'near', ['a.test.ts']))), mark).join('\n');
    expect(text).toContain('<details><summary>2 more changed functions</summary>\n\n- G `src/caps.ts:201-205` function `f20`, new — 1 case in 1 test file');
  });

  it('counts the cases alone when the record names none of them', () => {
    const text = functionsMarkdown(review([{ ...region('function', 'cap', 3, 20, 'near'), cases: 2 }]), mark).join('\n');
    expect(text).toContain('G `src/caps.ts:3-20` function `cap`, new — 2 cases');
  });

  it('writes nothing when no function changed', () => {
    expect(functionsMarkdown(review([region('module', '', 1, 40, 'near', ['a.test.ts'])]), mark)).toEqual([]);
  });
});
