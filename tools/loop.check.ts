import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The legs a script runs are asked for the way the leg's note says to ask.
 *
 * A seam leg's note names `VARIANCE_AUTHORITY_AT_DISTANCE` as the knob that
 * runs another leg: "the same run with `VARIANCE_AUTHORITY_AT_DISTANCE=2-`".
 * The edit loop is the script that note is printed under, so it sets its own
 * leg, `0-1`, as the default an outer value overrides.
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

  it('takes its leg from an outer VARIANCE_AUTHORITY_AT_DISTANCE', () => {
    expect(scripts['test:loop']).toContain('VARIANCE_AUTHORITY_AT_DISTANCE=${VARIANCE_AUTHORITY_AT_DISTANCE:-0-1}');
  });

  it('selects as a local seam, which a doubt never widens, and the gate does not', () => {
    expect(scripts['test:loop']).toContain('VARIANCE_AUTHORITY_LOCAL=1');
    expect(scripts['verify:near']).toContain('VARIANCE_AUTHORITY_LOCAL=1');
    expect(readFileSync('.github/workflows/check.yml', 'utf8')).not.toContain('VARIANCE_AUTHORITY_LOCAL');
  });

  it('hands its arguments to the runner', () => {
    expect(steps(scripts['test:loop']!).find((step) => VITEST.test(step))).toContain('"$@"');
  });

  it('starts with the repository\'s lint, as the near wave does', () => {
    expect(steps(scripts['test:loop']!)[0]).toBe(scripts.lint);
    expect(steps(scripts['verify:near']!)[0]).toBe(scripts.lint);
  });
});
