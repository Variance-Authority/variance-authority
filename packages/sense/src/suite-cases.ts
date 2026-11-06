/**
 * One reading of each suite's case record, shared by the questions that ask it
 * of a record's cases alone: where a suite that holds none says why.
 */

// compass: variance-authority.reach

import { keepsCases } from './test-selection/case-record.js';
import { nearestTestCoverage } from './test-selection/record-location.js';
import { declaredSuites } from './test-selection/suites.js';

/** What one suite's record answered, or why it holds no answer. */
export type SuiteCases<Answer> = {
  /** The suite, absent where the root config declares none. */
  readonly suite?: string;
  /** The record read. */
  readonly recording: string;
} & (Answer | { readonly unread: string });

/**
 * The reader `open` makes, over the nearest record of each suite the root config
 * declares, or the one record of a repository that declares none. A record that
 * kept no cases, and one the reader could not read, each answer with why; a
 * reader that cannot be made is refused, since no suite is to blame for it.
 */
export function eachSuiteCases<Answer extends object>(root: string, open: () => (recording: string) => Answer): readonly SuiteCases<Answer>[] {
  const suites = declaredSuites(root)?.map((declared) => declared.name) ?? [undefined];
  const read = open();
  return suites.map((suite) => {
    const named = suite === undefined ? {} : { suite };
    const recording = nearestTestCoverage(root, { suite });
    if (!keepsCases(recording)) return { ...named, recording, unread: 'no run kept its cases there' };
    try {
      return { ...named, recording, ...read(recording) };
    } catch (error) {
      return { ...named, recording, unread: error instanceof Error ? error.message : String(error) };
    }
  });
}
