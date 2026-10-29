import { describe, expect, it } from 'vitest';
import type { ChangedPackage, Review, ReviewFile, ReviewRegion } from './review.js';
import { formatReview } from './review-text.js';

const TEST = 'packages/a/test/total.test.ts';

const region = (kind: string, name: string, startLine: number, endLine: number, reach: ReviewRegion['reach'], edit: ReviewRegion['edit'] = 'modified'): ReviewRegion => {
  const tests = reach === 'near' ? [TEST] : [];
  return {
    kind, name, startLine, endLine, reach, edit,
    cases: tests.length, changedLineCases: tests.length, tests,
    called: tests.map((file) => ({ id: `${file} > total > ${name}`, file, name: `total > ${name}`, preconditions: [] })),
  };
};

/** A case ran `round` and a branch of `cap` in a text an edit wrote over; no case entered `spill`. */
const TOTAL: ReviewFile = { file: 'packages/a/src/total.ts', recorded: true, regions: [
  region('function', 'applyDiscount', 1, 3, 'near'),
  region('function', 'round', 5, 7, 'overwritten'),
  region('function', 'cap', 9, 14, 'near'),
  region('branch', 'cap', 11, 12, 'overwritten'),
] };
const SPILL: ReviewFile = { file: 'packages/b/src/spill.ts', recorded: true, regions: [region('function', 'spill', 1, 3, 'unwalked', 'new')] };

const pkg = (name: string, functions: number, reaches: ChangedPackage['reaches'], uncovered: number, overwritten: number, own: boolean): ChangedPackage =>
  ({ package: name, path: `packages/${name}`, functions, reaches, uncovered, overwritten, own, tests: [], importers: 0 });

const comment = (files: readonly ReviewFile[], record: Review['record'] = 'ran', changedPackages?: readonly ChangedPackage[]): string =>
  formatReview({ from: 'a'.repeat(40), record, base: 'since', files, ...(changedPackages === undefined ? {} : { changedPackages }) } as unknown as Review, 'markdown');

describe('a review comment of code a case ran in a text an edit wrote over', () => {
  it('counts that code as code no case is known to have run in every part of the comment, never as code no case ran', () => {
    const markdown = comment([TOTAL, SPILL], 'ran', [pkg('a', 3, { near: 2, overwritten: 1 }, 0, 2, true), pkg('b', 1, { unwalked: 1 }, 1, 0, false)]);

    expect(markdown).toContain([
      '> [!WARNING]',
      '> **1 of 4 changed functions has code no case ran:** `spill`.',
      '> **2 more have code no case is known to have run:** `round`, `cap`.',
    ].join('\n'));
    expect(markdown).toContain([
      '| Package | Changed functions | Ran | With code no case ran | With code no case is known to have run | Tests from | Packages importing it |',
      '|---|--:|---|--:|--:|---|--:|',
      '| `b` | 1 | 🔴 1 | 1 | 0 | none | 0 |',
      '| `a` | 3 | 🟢 2 · ❔ 1 | 0 | 2 | own | 0 |',
    ].join('\n'));
    expect(markdown).toContain('⚪ ran only while its module loaded · ❔ no case is known to have run it · 🔴 no case ran it</sub>');
    expect(markdown).toContain('<details><summary>🔴 Where no case ran: 1 place in 1 function</summary>\n\n- `packages/b/src/spill.ts:1-3` function `spill` (new)\n');
    expect(markdown).toContain([
      '<details><summary>❔ Where no case is known to have run: 2 places in 2 functions</summary>',
      '',
      '- `packages/a/src/total.ts:5-7` function `round` (modified)',
      '- `packages/a/src/total.ts:11-12` branch in `cap` (modified)',
    ].join('\n'));
    expect(markdown).toContain('🧪 What ran 2 changed functions');
    expect(markdown).not.toContain('| `round` |');
    expect(markdown).toContain('<summary>🔀 4 changed functions, 1 with no case, 1 with no case known to have run it</summary>');
    expect(markdown).toContain('"❔ round · modified<br/>no case is known to have run it"]:::notknown');
    expect(markdown).toContain('"🟢 cap · modified<br/>1 case, 1 ran a changed line · 1 place no case is known to have run"]:::near');
    expect(markdown).toContain('| 🟢 2 near · ❔ 2 overwritten |');
    expect(markdown).not.toContain('undefined');
  });

  it('notes code no case is known to have run, rather than warn of code no case ran, when that is all the gap there is', () => {
    expect(comment([TOTAL])).toContain('> [!NOTE]\n> **2 of 3 changed functions have code no case is known to have run:** `round`, `cap`.');
    expect(comment([TOTAL])).not.toContain('[!TIP]');
    expect(comment([TOTAL], 'before')).toContain('> [!NOTE]\n> **2 of 3 changed functions have code no case in the record is known to have run:** `round`, `cap`.');
    expect(comment([TOTAL], 'before')).toContain('<details><summary>❔ Where no case in the record is known to have run: 2 places in 2 functions</summary>');
  });
});
