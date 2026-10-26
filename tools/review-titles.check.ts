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
// quoted titles joined by commas, `and` or `or`. Line breaks are folded first,
// because a title wraps like any other prose.
const PINNED = /\[[^\]]+\]\(([^)#\s]+)\)\s*›\s*((?:"[^"]+"(?:,|\s+and|\s+or)?\s*)+)/g;

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

function pinsIn(review: string): readonly Pin[] {
  const text = readFileSync(join(ROOT, review), 'utf8').replace(/\s+/g, ' ');
  return [...text.matchAll(PINNED)].flatMap((match) =>
    [...match[2].matchAll(/"([^"]+)"/g)].map((title) => ({
      review,
      test: join(dirname(review), match[1]),
      title: title[1],
    })),
  );
}

describe('a test title a REVIEW.md quotes', () => {
  const pins = REVIEWS.flatMap(pinsIn);

  it('is found in the cascade at all', () => {
    expect(pins.length).toBeGreaterThan(0);
  });

  it('is a title of the test file its link names', () => {
    const missing = pins
      .filter((pin) => !existsSync(join(ROOT, pin.test)) || !source(join(ROOT, pin.test)).includes(pin.title))
      .map((pin) => `  ${pin.review}: "${pin.title}" is not in ${pin.test}`);
    expect(missing.join('\n')).toBe('');
  });
});
