import { resetCaptures } from '@variance-authority/unit-test';

/**
 * Clear last run's captures, once, before any test file opens.
 *
 * Vitest calls this once per run; the test files run in workers after it. A
 * capture directory is meant to hold one run, so that two tests claiming the
 * same subject id is an error rather than a silent overwrite — this is what
 * makes the directory hold one run.
 */
export async function setup() {
  await resetCaptures('.variance/captures');
}
