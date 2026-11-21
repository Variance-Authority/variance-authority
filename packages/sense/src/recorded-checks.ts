/**
 * The declared checks the latest run did not execute, case by case.
 *
 * A case declares the checks it stands for; a run enters one when the case
 * executes the step of its id (`test-selection/checks-record.ts`). A case that
 * passed without entering a declared check passed without the check: the
 * verdict and the check part there. Read from what the run left in the record,
 * the way `recordedAttempts` reads how retried cases ended: the nearest layer
 * holding a record answers, for each suite the root config declares. Nothing
 * here runs a test, and it speaks of one recorded run in the scope it ran in.
 *
 * A run the runner did not end itself names no check missing, and a record
 * whose run kept no checks is answered as that, never as nothing missing.
 */

// compass: variance-authority.reach

import { existsSync } from 'node:fs';
import { readChecks, type ChecksReading } from './test-selection/checks-record.js';
import { recordedChecksAt } from './test-selection/case-record.js';
import { nearestRecord, type RecordOrigin } from './test-selection/record-location.js';
import { declaredSuites } from './test-selection/suites.js';

/** What one record says of its run's declared checks, or why it does not say. */
export type CheckedRun =
  | ({
      /** The commit the checks' own run stood at; absent where it named none. */
      readonly commit?: string;
      /** When the checks' own run landed them, as ISO 8601; absent where they do not say. */
      readonly landed?: string;
    } & ChecksReading)
  /** The record's latest run kept no checks: none of its cases declared one, its runner does not report them, or a build older than them wrote it. */
  | { readonly unkept: true }
  | { readonly unread: string };

/** One suite's checks, and the record that answered. */
export type RecordedChecks = { readonly suite?: string; readonly recording: string; readonly origin: RecordOrigin } & CheckedRun;

// TODO: only the Playwright reporter keeps checks. Vitest, Jest and Rstest
// report no step a case entered — Vitest has annotations and no steps, Jest
// neither — so their records read as checks not kept until one does.
/** For each suite the root config declares, or the one record of a repository that declares none: what its latest run's checks say. */
export function recordedChecks(root: string): readonly RecordedChecks[] {
  const suites = declaredSuites(root)?.map((suite) => suite.name) ?? [undefined];
  return suites.map((suite) => {
    const { file: recording, origin } = nearestRecord(root, { suite });
    return { ...(suite === undefined ? {} : { suite }), recording, origin, ...checksAt(recording) };
  });
}

/** What the record at `recording` says of its latest run's declared checks. */
export function checksAt(recording: string): CheckedRun {
  if (!existsSync(recording)) return { unread: 'nothing is recorded there' };
  try {
    // The checks name their own run: the coverage beside them, if any, may be
    // an earlier run's, and a record that keeps cases alone has none.
    const section = recordedChecksAt(recording);
    if (section === undefined) return { unkept: true };
    const { commit, landed } = section;
    return { ...(commit === undefined ? {} : { commit }), ...(landed === undefined ? {} : { landed }), ...readChecks(section) };
  } catch (error) {
    return { unread: error instanceof Error ? error.message : String(error) };
  }
}
