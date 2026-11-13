/**
 * The recorded cases whose attempts ended differently, as their runner said
 * each attempt ended.
 *
 * Read from what a recorded run published, the way `recordedDurations` reads
 * what each case cost: the nearest layer holding a record answers, for each
 * suite the root config declares. A runner that retries a case reports its
 * last attempt as the case's outcome, so a case that failed and then passed
 * reads as passed everywhere else; the attempts beside the case index
 * (`test-selection/attempts-record.ts`) are what tell the two apart. Nothing
 * here runs a test or retries one, and it speaks of one recorded run: a case
 * that ended the same way every attempt is counted, not listed, and one that
 * ran once has nothing to compare.
 *
 * A record written before attempts were kept is answered as that, never as a
 * run in which no case was retried.
 */

// compass: variance-authority.reach

import { existsSync, readFileSync } from 'node:fs';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { RecordedAttempt } from './test-selection/attempts-record.js';
import { keepsCases, recordedAttemptsAt } from './test-selection/case-record.js';
import { askCoverageFile } from './test-selection/coverage-file.js';
import { decodeExecutionTests } from './test-selection/execution-format.js';
import { nearestRecord, type RecordOrigin } from './test-selection/record-location.js';
import { declaredSuites } from './test-selection/suites.js';
import { takenAt } from './recorded-durations.js';

/** One retried case, the file that declares it, and how each of its attempts ended, first attempt first. */
export interface RetriedCase {
  readonly file: string;
  /** The declaration path inside the file, as the case index names it. */
  readonly name: string;
  /** The milliseconds its runner allowed one attempt; absent where no limit was recorded. */
  readonly limit?: number;
  readonly attempts: readonly Omit<RecordedAttempt, 'case'>[];
}

/** One suite's retried cases, or why its record does not say. */
export type RecordedAttempts = { readonly suite?: string; readonly recording: string; readonly origin: RecordOrigin } & (
  | {
      /** The commit the record was taken at; absent where it names none. */
      readonly commit?: string;
      /** When the record's latest run landed, as ISO 8601; absent where no runs record beside it stands at this commit. */
      readonly landed?: string;
      /** The cases whose attempts ended differently, in path and then name order, at most the limit asked for. */
      readonly differed: readonly RetriedCase[];
      /** Every case whose attempts ended differently. */
      readonly differing: number;
      /** Every case the run entered more than once, however its attempts ended. */
      readonly retried: number;
      /** Every case the record holds. */
      readonly cases: number;
    }
  /** The record holds cases and no attempts: a run older than attempts wrote it. */
  | { readonly commit?: string; readonly landed?: string; readonly unkept: true }
  | { readonly unread: string }
);

/**
 * For each suite the root config declares, or the one record of a repository
 * that declares none: the `limit` cases its latest recording says ended
 * differently from one attempt to the next, with every attempt of each.
 */
export function recordedAttempts(root: string, limit: number): readonly RecordedAttempts[] {
  const suites = declaredSuites(root)?.map((suite) => suite.name) ?? [undefined];
  return suites.map((suite) => {
    const { file: recording, origin } = nearestRecord(root, { suite });
    const read = { ...(suite === undefined ? {} : { suite }), recording, origin };
    if (!existsSync(recording)) return { ...read, unread: 'nothing is recorded there' };
    if (!keepsCases(recording)) return { ...read, unread: 'no run kept its cases there' };
    try {
      const rows = recordedAttemptsAt(recording);
      const taken = takenAt(recording, askCoverageFile(recording, (view) => view.commit));
      if (rows === undefined) return { ...read, ...taken, unkept: true };
      const tests = decodeExecutionTests(readFileSync(recording));
      const retried = retriedCases(rows, new Map(tests.map((test) => [test.id, test])));
      const differed = retried.filter(({ attempts }) => new Set(attempts.map((attempt) => attempt.ended)).size > 1);
      return { ...read, ...taken, differed: differed.slice(0, limit), differing: differed.length, retried: retried.length, cases: tests.length };
    } catch (error) {
      return { ...read, unread: error instanceof Error ? error.message : String(error) };
    }
  });
}

/** `rows` as one entry per case, in code-unit order of path and then of name; the section orders a case's attempts. */
function retriedCases(
  rows: readonly RecordedAttempt[],
  cases: ReadonlyMap<string, { readonly file: string; readonly name: string; readonly limit?: number }>,
): RetriedCase[] {
  const held = new Map<string, Omit<RecordedAttempt, 'case'>[]>();
  for (const { case: id, ...attempt } of rows) held.set(id, [...(held.get(id) ?? []), attempt]);
  return [...held]
    .map(([id, attempts]) => {
      const named = cases.get(id);
      if (named === undefined) throw new Error(`an attempt names a case the record does not hold: ${id}`);
      return { file: named.file, name: named.name, ...(named.limit === undefined ? {} : { limit: named.limit }), attempts };
    })
    .sort((left, right) => codeUnitOrder(left.file, right.file) || codeUnitOrder(left.name, right.name));
}
