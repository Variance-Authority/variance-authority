// compass: variance-authority/runtime/attention

/**
 * Which test files a record holds a file as a precondition of: the ones that
 * loaded it without instrumenting it, and the ones that declare it.
 *
 * `variance select` reads the same table (`testsGovernedBy`) and selects every
 * one of those files whole when the file changes, so `covering` names them and
 * `review` counts them from this one reading rather than two.
 */

import { askCoverageFile, testsGovernedBy } from '@variance-authority/sense/test-selection';

/** What the record says about the asked files as preconditions. */
export interface HeldAsPrecondition {
  /** How many test files the record holds. */
  readonly tests: number;
  /**
   * Each asked file that some test file holds, with those test files in
   * code-unit order. A file no test file holds is absent. A test file is a
   * precondition of itself, and is not named for that.
   */
  readonly of: ReadonlyMap<string, readonly string[]>;
}

/**
 * {@link HeldAsPrecondition} for `files` in the record at `record`, or
 * `undefined` when the record's coverage cannot be read: a path that is not a
 * coverage record, a record that kept cases and no coverage, or one that does
 * not decode. That is not the same as no test file holding them, and a caller
 * must not say it is.
 */
export function heldAsPrecondition(record: string, files: readonly string[]): HeldAsPrecondition | undefined {
  try {
    return askCoverageFile(record, (coverage) => {
      const of = new Map<string, string[]>();
      for (const [test, names] of testsGovernedBy(coverage, files).tests) {
        const own = coverage.string(coverage.testPath.at(test));
        for (const name of names) {
          if (name === own) continue;
          const tests = of.get(name) ?? [];
          tests.push(own);
          of.set(name, tests);
        }
      }
      for (const tests of of.values()) tests.sort();
      return { tests: coverage.testPath.length, of };
    });
  } catch {
    return undefined;
  }
}
