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
import { keepsCases } from './test-selection/case-record.js';
import { decodeExecutionTests } from './test-selection/execution-format.js';
import { nearestTestCoverage } from './test-selection/record-location.js';
import { declaredSuites } from './test-selection/suites.js';

/** A case, by the test file that holds it and the name it ran under. */
export interface RecordedCaseName {
  readonly file: string;
  readonly name: string;
}

/** One suite's cases, or why it holds none. */
export type RecordedCaseNames = {
  /** The suite, absent where the root config declares none. */
  readonly suite?: string;
  /** The record read. */
  readonly recording: string;
} & ({ readonly cases: readonly RecordedCaseName[] } | { readonly unread: string });

/** Every case each suite's nearest record holds, one answer to a suite. */
export function recordedCaseNames(root: string): readonly RecordedCaseNames[] {
  const suites = declaredSuites(root)?.map((declared) => declared.name) ?? [undefined];
  return suites.map((suite) => {
    const named = suite === undefined ? {} : { suite };
    const recording = nearestTestCoverage(root, { suite });
    if (!keepsCases(recording)) return { ...named, recording, unread: 'no run kept its cases there' };
    try {
      return { ...named, recording, cases: decodeExecutionTests(readFileSync(recording)).map(({ file, name }) => ({ file, name })) };
    } catch (error) {
      return { ...named, recording, unread: error instanceof Error ? error.message : String(error) };
    }
  });
}
