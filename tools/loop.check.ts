import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The edit loop answers in seconds: it runs the changed files' own tests, as
 * many as fit in `VARIANCE_AUTHORITY_BUDGET` seconds of recorded test time, 15
 * unless an outer value says otherwise. Widening past them is the caller's
 * decision, asked the way a leg's note says to ask, with
 * `VARIANCE_AUTHORITY_AT_DISTANCE`; the loop sets no leg of its own.
 *
 * An argument goes to the runner, which runs a file or a filter it is given
 * and refuses a flag it does not take, rather than to the step after it, which
 * read none.
 *
 * Lint is the loop's first step and the same command the near wave starts
 * with, so a lint failure reaches the edit that made it and near finds no other.
 */

const steps = (line: string) => line.split('&&').map((step) => step.trim());
const VITEST = /\bvitest run\b/;

describe('the edit loop', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>;

  it('runs within 15 s of recorded test time unless an outer VARIANCE_AUTHORITY_BUDGET says otherwise', () => {
    expect(scripts['test:loop']).toContain('VARIANCE_AUTHORITY_BUDGET=${VARIANCE_AUTHORITY_BUDGET:-15}');
  });

  it('widens past the own tests only when the caller asks a leg', () => {
    expect(scripts['test:loop']).not.toMatch(/VARIANCE_AUTHORITY_AT_DISTANCE=\S/);
  });

  it('hands its arguments to the runner', () => {
    expect(steps(scripts['test:loop']!).find((step) => VITEST.test(step))).toContain('"$@"');
  });

  it('starts with the repository\'s lint, as the near wave does', () => {
    expect(steps(scripts['test:loop']!)[0]).toBe(scripts.lint);
    expect(steps(scripts['verify:near']!)[0]).toBe(scripts.lint);
  });
});
