import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The edit loop reads what the source index says now.
 *
 * The seam places each test by import hops over the published source index,
 * and nothing in a run writes that index: a file added since the last
 * `variance index` has no hops, so its test runs only in the open leg and the
 * loop's `0-1` skips it. The loop line refreshes the index before the runner
 * selects, here and in the line `docs/test-an-edit.md` hands a reader.
 *
 * An argument goes to the runner, which runs a file or a filter it is given
 * and refuses a flag it does not take, rather than to the step after it, which
 * read none.
 */

const steps = (line: string) => line.split('&&').map((step) => step.trim());

function before(line: string, first: RegExp, then: RegExp): boolean {
  const ran = steps(line);
  const at = ran.findIndex((step) => first.test(step));
  const later = ran.findIndex((step) => then.test(step));
  return at !== -1 && later !== -1 && at < later;
}

const VITEST = /\bvitest run\b/;
const INDEX = /\bvariance index\b/;

describe('the edit loop', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>;
  const loop = scripts['test:loop']!;

  it('refreshes the source index before the runner selects', () => {
    expect(before(loop, INDEX, VITEST)).toBe(true);
  });

  it('hands its arguments to the runner', () => {
    expect(steps(loop).find((step) => VITEST.test(step))).toContain('"$@"');
  });

  it('is published as a line that refreshes the source index first', () => {
    const published = readFileSync('docs/test-an-edit.md', 'utf8')
      .split('\n')
      .filter((line) => line.includes('VARIANCE_AUTHORITY_AT_DISTANCE=0-1') && VITEST.test(line));
    expect(published).not.toEqual([]);
    for (const line of published) expect(before(line, INDEX, VITEST), line).toBe(true);
  });
});
