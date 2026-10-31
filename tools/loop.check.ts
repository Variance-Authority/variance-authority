import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The legs a script runs are asked for the way the leg's note says to ask.
 *
 * A seam leg's note names `VARIANCE_AUTHORITY_AT_DISTANCE` as the knob that
 * runs another leg: "the same run with `VARIANCE_AUTHORITY_AT_DISTANCE=2-`".
 * The edit loop is the script that note is printed under, so it sets its own
 * leg as the default an outer value overrides; the waves fix theirs, since a
 * gate stamped for a leg must have run it.
 *
 * An argument goes to the runner, which runs a file or a filter it is given
 * and refuses a flag it does not take, rather than to the step after it, which
 * read none.
 */

const steps = (line: string) => line.split('&&').map((step) => step.trim());
const VITEST = /\bvitest run\b/;

describe('the edit loop', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>;

  it('takes its leg from an outer VARIANCE_AUTHORITY_AT_DISTANCE', () => {
    expect(scripts['test:loop']).toContain('VARIANCE_AUTHORITY_AT_DISTANCE=${VARIANCE_AUTHORITY_AT_DISTANCE:-');
  });

  it('hands its arguments to the runner', () => {
    expect(steps(scripts['test:loop']!).find((step) => VITEST.test(step))).toContain('"$@"');
  });
});
