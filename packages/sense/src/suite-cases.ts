/**
 * One reading of each suite's case record: the walk every question asked of a
 * recording's cases shares, and the one place a suite that holds none says why.
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
 * `read` over the nearest record of each suite the root config declares, or the
 * one record of a repository that declares none. A record that kept no cases,
 * and one `read` could not open, each answer with why.
 */
export function eachSuiteCases<Answer extends object>(root: string, read: (recording: string) => Answer): readonly SuiteCases<Answer>[] {
  const suites = declaredSuites(root)?.map((declared) => declared.name) ?? [undefined];
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
