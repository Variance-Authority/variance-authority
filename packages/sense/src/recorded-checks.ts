/**
 * The declared checks the latest run did not enter, case by case.
 *
 * A case declares a check by calling `checked(id, fn)` in its body, read from
 * its test file before the run; an attempt enters it when the call runs
 * (`test-selection/checks-record.ts`). An attempt that passed without entering
 * a declared check passed without the check: the verdict and the check part
 * there. Read from what the run left in the record, the way `recordedAttempts`
 * reads how retried cases ended: the nearest layer holding a record answers,
 * for each suite the root config declares. Nothing here runs a test, and it
 * speaks of one recorded run, under whichever runner ran it.
 *
 * A file whose recording did not run to the end names no check missing, and a
 * record whose run kept no checks is answered as that, never as nothing missing.
 * Nor does a run that began after the checks landed and never landed its own: a
 * run killed outright, under any runner, leaves its `.run-*` directories beside
 * the record, and only its fold removes them.
 */

// compass: variance-authority.reach

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readChecks, type ChecksReading } from './test-selection/checks-record.js';
import { recordedChecksAt } from './test-selection/case-record.js';
import { nearestRecord, type RecordOrigin } from './test-selection/record-location.js';
import { declaredSuites } from './test-selection/suites.js';

/** The run that landed a record's checks. */
interface ChecksRun {
  /** The commit the checks' own run stood at; absent where it named none. */
  readonly commit?: string;
  /** When the checks' own run landed them, as ISO 8601; absent where they do not say. */
  readonly landed?: string;
}

/** What one record says of its run's declared checks, or why it does not say. */
export type CheckedRun =
  | (ChecksRun & ChecksReading)
  /** A later run began beside the record and did not land: it was stopped before its runner ended it, or it is still running. When it last wrote, as ISO 8601. */
  | (ChecksRun & { readonly unfinished: string })
  /** The record's latest run kept no checks: none of the cases it ran declared one, or a build older than them wrote it. */
  | { readonly unkept: true }
  | { readonly unread: string };

/** One suite's checks, and the record that answered. */
export type RecordedChecks = { readonly suite?: string; readonly recording: string; readonly origin: RecordOrigin } & CheckedRun;

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
    const run = { ...(commit === undefined ? {} : { commit }), ...(landed === undefined ? {} : { landed }) };
    const unfinished = unlandedSince(recording, landed === undefined ? statSync(recording).mtimeMs : Date.parse(landed));
    return unfinished === undefined ? { ...run, ...readChecks(section) } : { ...run, unfinished };
  } catch (error) {
    return { unread: error instanceof Error ? error.message : String(error) };
  }
}

/** When a run that began beside `recording` no earlier than `since` and has not landed last wrote, as ISO 8601; `undefined` when none did. */
function unlandedSince(recording: string, since: number): string | undefined {
  const directory = dirname(recording);
  const latest = Math.max(-Infinity, ...readdirSync(directory)
    .filter((name) => name.startsWith('.run-'))
    .map((name) => statSync(join(directory, name), { throwIfNoEntry: false })?.mtimeMs ?? -Infinity)
    .filter((at) => at >= since));
  return latest === -Infinity ? undefined : new Date(latest).toISOString();
}
