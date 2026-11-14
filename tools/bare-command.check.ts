import { describe, expect, it } from 'vitest';
import { PUBLIC_MARKDOWN, lineOf, prose } from './markdown.js';

/**
 * `variance` is a devDependency of every project that runs it, so a page prints the bare command and the
 * package manager finds the installed copy. A runner that fetches on a miss would download an unrelated
 * package of the same name; a workflow step, which has no package manager in front, prints `--no-install`.
 */
const FETCHING = /npx variance(?![\w-])/g;

/** The changelog quotes the wording of the release it records. */
const HISTORY = /^docs\/changelog\.md$/;

describe('a page that runs the installed CLI prints the bare command', () => {
  it.each(PUBLIC_MARKDOWN.filter((file) => !HISTORY.test(file)))('%s', (file) => {
    const text = prose(file);
    const fetching = [...text.matchAll(FETCHING)].map((match) => `${file}:${lineOf(text, match.index)}`);
    expect(fetching).toEqual([]);
  });
});
