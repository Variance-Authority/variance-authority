/**
 * The name each recorded test case ran under, as `variance ask search` reads it.
 *
 * Read from the nearest record of each suite the root config declares, as
 * `recordedDurations` reads the figures: a local run's record is already laid
 * over its base, so one read holds both, and it lags the checkout until a run
 * writes it. A record is the only place a name is the runner's own, whatever the
 * file wrote to get it. A suite that holds none says why, never an empty list.
 */

// compass: variance-authority.reach

import { readFileSync } from 'node:fs';
import { eachSuiteCases, type SuiteCases } from './suite-cases.js';
import { decodeExecutionTests } from './test-selection/execution-format.js';

/** A case, by the test file that holds it and the name it ran under. */
export interface RecordedCaseName {
  readonly file: string;
  readonly name: string;
}

/** One suite's cases, or why it holds none. */
export type RecordedCaseNames = SuiteCases<{ readonly cases: readonly RecordedCaseName[] }>;

/** Every case each suite's nearest record holds, one answer to a suite. */
export function recordedCaseNames(root: string): readonly RecordedCaseNames[] {
  return eachSuiteCases(root, (recording) => ({
    cases: decodeExecutionTests(readFileSync(recording)).map(({ file, name }) => ({ file, name })),
  }));
}
