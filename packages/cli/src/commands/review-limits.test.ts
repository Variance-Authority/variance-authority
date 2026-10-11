import { describe, expect, it } from 'vitest';
import type { Review } from './review.js';
import { formatReview, REVIEW_MARKER } from './review-text.js';

const AGAINST = 'a'.repeat(40);
const DISCOUNTS = { id: 'test/total.test.ts > discounts', file: 'test/total.test.ts', name: 'discounts', stopped: false };
const answer: Review = { from: 'f'.repeat(40), base: 'since', record: 'ran', files: [], suite: 1 };

describe('a review comment GitHub accepts', () => {
  it('lists a bounded number of moved regions and files in the comment, and cuts the comment to GitHub\'s limit', () => {
    const regions = Array.from({ length: 100 }, (_, at) => ({
      file: 'src/total.ts', startLine: at + 1, endLine: at + 1, kind: 'function' as const, name: `f${at + 1}`,
      motion: 'lost' as const, before: [DISCOUNTS], now: [],
    }));
    const unread = Array.from({ length: 50 }, (_, at) => `src/unread-${at}.ts`);
    const moved = { regions, counts: { lost: 100, hidden: 0, thinned: 0, gained: 0 }, testFiles: [], unread };
    const unwritten = Array.from({ length: 5000 }, (_, at) => `test/skipped-${at}.chromium.test.ts`);

    const listed = formatReview({ ...answer, motion: { base: { from: AGAINST, kind: 'record' }, moved, unwritten } }, 'markdown');

    expect(listed).toContain('  lost     src/total.ts 40-40 function f40 — was test/total.test.ts > discounts');
    expect(listed).not.toContain('function f41 —');
    expect(listed).toContain('... and 60 more regions, not listed here; --format json lists every one.');
    expect(listed).toContain('src/unread-39.ts, and 10 more files, which --format json lists.');
    expect(listed).toContain('test/skipped-39.chromium.test.ts, and 4960 more test files, which --format json lists.');
    expect(listed).not.toContain('test/skipped-40.');

    const files = Array.from({ length: 3000 }, (_, at) => ({ file: `src/generated/module-${at}.ts`, created: true }));
    const cut = formatReview({ ...answer, files }, 'markdown');

    expect(cut.length).toBeLessThanOrEqual(65_536);
    expect(cut.startsWith(`${REVIEW_MARKER}\n`)).toBe(true);
    expect(cut).toMatch(/<\/details>\n\n<\/details>\n\n> \d+ characters of this review are not shown, because GitHub rejects a comment longer than 65536\. `--format json` prints the whole review/);
  });
});
