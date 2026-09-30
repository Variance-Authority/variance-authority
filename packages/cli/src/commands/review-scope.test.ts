import { describe, expect, it } from 'vitest';
import { scopeMarkdown, uncoveredCallout } from './review-scope.js';
import type { Review, ReviewRegion } from './review.js';

const region = (kind: string, name: string, startLine: number, endLine: number, reach: ReviewRegion['reach'], tests: readonly string[] = []): ReviewRegion => ({
  kind,
  name,
  startLine,
  endLine,
  reach,
  written: true,
  cases: tests.length,
  tests,
});

const review = (regions: readonly ReviewRegion[]): Review =>
  ({ from: 'abc', base: 'since', files: [{ file: 'src/caps.ts', regions }] }) as unknown as Review;

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
    expect(lines.at(-1)).toBe('> - and 2 more, under 📍 below.');
  });

  it('folds the uncovered regions first, then each changed function with the test files that ran it', () => {
    const text = scopeMarkdown(review([
      region('module', '', 1, 40, 'near', ['a.test.ts']),
      region('function', 'cap', 3, 20, 'near', ['a.test.ts', 'b.test.ts']),
      region('function', 'cap/map.arg0', 5, 5, 'near', ['a.test.ts']),
      region('function', 'spill', 22, 25, 'unwalked'),
    ]), mark).join('\n');
    expect(text).toContain('<summary>📍 The test files that ran each changed function, and the 1 changed region none ran</summary>');
    expect(text).toContain('- R `src/caps.ts:22-25` function `spill`, new — no case ran it\n- G `src/caps.ts:3-20` function `cap`, new — 2 cases in `a.test.ts`, `b.test.ts`');
    expect(text).not.toContain('cap/map.arg0');
    expect(text).not.toContain('module');
  });

  it('names five test files for a function and counts the rest', () => {
    const tests = Array.from({ length: 7 }, (_, index) => `t${index}.test.ts`);
    const text = scopeMarkdown(review([region('function', 'cap', 3, 20, 'near', tests)]), mark).join('\n');
    expect(text).toContain('`t4.test.ts` and 2 more test files');
    expect(text).not.toContain('t5.test.ts');
  });

  it('writes nothing when no function changed', () => {
    expect(scopeMarkdown(review([region('module', '', 1, 40, 'near', ['a.test.ts'])]), mark)).toEqual([]);
  });
});
