import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKDOWN, ROOT } from './markdown.js';

/**
 * A contract in a `REVIEW.md` that is pinned by a test names the test by its
 * title: `[file.test.ts](src/file.test.ts) › "title"`. The title is a second
 * copy of a string the test file owns, so a renamed test would leave the review
 * contract pointing at nothing while every link still resolves. This check
 * holds each quoted title to the file its link names; the links themselves are
 * `docs-links.check.ts`'s.
 */

const REVIEWS = MARKDOWN.filter((file) => file === 'REVIEW.md' || file.endsWith('/REVIEW.md'));

// A link, the `›` that says what follows is a test title, then one or more
// quoted titles joined by commas, `and` or `or`. A quote inside a title is
// escaped, `\"`, as Markdown renders it. Line breaks are folded first, because a
// title wraps like any other prose.
const TITLE = /"((?:[^"\\]|\\.)+)"/g;
const PINNED = /\[[^\]]+\]\(([^)#\s]+)\)\s*›\s*((?:"(?:[^"\\]|\\.)+"(?:,|\s+and|\s+or)?\s*)+)/g;

/** A `›` outside a link's text says a test title follows, so each one belongs to a pin. */
const ARROW = /›/g;

/** The test source with its string escapes read, as the runner reports the title. */
function source(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\\(['"`])/g, '$1')
    .replace(/\s+/g, ' ');
}

interface Pin {
  readonly review: string;
  readonly test: string;
  readonly title: string;
}

function text(review: string): string {
  return readFileSync(join(ROOT, review), 'utf8').replace(/\s+/g, ' ');
}

function pinsIn(review: string): readonly Pin[] {
  return [...text(review).matchAll(PINNED)].flatMap((match) =>
    [...match[2].matchAll(TITLE)].map((title) => ({
      review,
      test: join(dirname(review), match[1]),
      title: title[1].replace(/\\(.)/g, '$1'),
    })),
  );
}

/** How many `›` in a review's prose, outside link texts such as `[README › Section]`, no pin reads. */
function unpinned(review: string): number {
  const prose = text(review).replace(/\[[^\]]*\]/g, '[]');
  return (prose.match(ARROW)?.length ?? 0) - (text(review).match(PINNED)?.length ?? 0);
}

/** Whether the test source declares the title whole, between the quotes it was written in. */
function declares(test: string, title: string): boolean {
  const body = source(test);
  return ["'", '"', '`'].some((quote) => body.includes(`${quote}${title}${quote}`));
}

describe('a test title a REVIEW.md quotes', () => {
  const pins = REVIEWS.flatMap(pinsIn);

  it('is found in the cascade at all', () => {
    expect(pins.length).toBeGreaterThan(0);
  });

  it('follows a link to the test file that declares it', () => {
    const loose = REVIEWS.filter((review) => unpinned(review) !== 0).map(
      (review) => `  ${review}: ${unpinned(review)} › with no test link and quoted title the check reads`,
    );
    expect(loose.join('\n')).toBe('');
  });

  it('is a whole title of the test file its link names', () => {
    const missing = pins
      .filter((pin) => !existsSync(join(ROOT, pin.test)) || !declares(join(ROOT, pin.test), pin.title))
      .map((pin) => `  ${pin.review}: "${pin.title}" is not a title in ${pin.test}`);
    expect(missing.join('\n')).toBe('');
  });
});
