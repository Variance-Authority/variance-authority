import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * The review action's two jobs: the one that runs the pull request's code holds
 * no write token, and the one that holds it runs none of that code.
 *
 * A test, or a package it installs, can read every token its job holds: the
 * runner reaps what a step left running only when the job ends, so a later
 * step's environment is readable from `/proc`. `comment: 'false'` hands the
 * review on instead of posting it, and `from` posts it in a job that runs
 * nothing else.
 */
const ACTION = resolve(import.meta.dirname, '..', '.github', 'actions', 'variance', 'review', 'action.yml');

interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly with?: Readonly<Record<string, string>>;
}

const steps = (parse(readFileSync(ACTION, 'utf8')) as { runs: { steps: readonly Step[] } }).runs.steps;
const label = (step: Step): string => step.name ?? step.id ?? step.uses ?? '?';
const condition = (step: Step): string => step.if ?? '';
const text = (step: Step): string => JSON.stringify(step);

describe('the review action', () => {
  it("reads the token only in a step that `comment: 'false'` skips", () => {
    const reading = steps.filter((step) => text(step).includes('inputs.github-token'));

    expect(reading.map(label)).toEqual(['post the review', 'publish the badge']);
    for (const step of reading) expect(condition(step)).toContain("inputs.comment != 'false'");
  });

  it('runs nothing of the pull request with `from`: it takes the review, posts it and pushes the badge', () => {
    const running = steps.filter((step) => !condition(step).includes("inputs.from == ''"));

    expect(running.map(label)).toEqual(['take the review', 'post the review', 'publish the badge']);
    for (const step of running) expect(text(step)).not.toMatch(/inputs\.(test|command)\b|actions\/checkout/u);
  });
});
