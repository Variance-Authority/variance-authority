/**
 * How each attempt of a case ended, as the runner that ran it reported it.
 *
 * Nothing here watches a body. A runner ends an attempt for reasons its body
 * never sees — its limit, a soft assertion, a `done(error)`, a failing hook —
 * so only its report says how the attempt ended, and it is joined to the
 * recorded case as the runner's duration is (`case-durations.ts`). What a
 * report leaves out of an attempt stays absent, and a runner whose report
 * counts no attempts leaves the case without any.
 */

import { recordedAttempt, retriedAttempts, triedAgain, type ObservedAttempt, type RecordedAttempt } from './attempts-record.js';
import { caseKey, type CaseCoordinate } from './cases.js';
import { reportedByCase, type FinishedFile } from './case-durations.js';

/** The attempts a runner reported for one recorded case, or `undefined` when it reported none for it. */
export type CaseAttempts = (file: string, name: string, id: string) => readonly ObservedAttempt[] | undefined;

/**
 * The attempts every announcement of a finished file reported, keyed the way a
 * recorded case is; `undefined` when no announced case carried any, which is a
 * run that kept no attempts. A name one file declares twice, and a case two
 * projects both ran, cannot say whose attempts these are, so neither has any.
 */
export function caseAttempts(files: readonly FinishedFile[], root: string): CaseAttempts | undefined {
  if (!files.some((file) => file.cases?.some((held) => held.attempts !== undefined))) return undefined;
  return reportedByCase<readonly ObservedAttempt[]>(files, root, (held) => held.attempts, () => null);
}

/**
 * The rows of the cases a run recorded that `tried` reports more than one
 * attempt of, each joined to its case by the id `ids` gives it; `undefined`
 * when the run's report counted no attempts.
 */
export function triedAttempts(
  cases: readonly CaseCoordinate[],
  ids: ReadonlyMap<string, string>,
  tried: CaseAttempts | undefined,
  root: string,
): readonly RecordedAttempt[] | undefined {
  return tried === undefined ? undefined : retriedAttempts(cases.flatMap((held) => {
    const attempts = tried(held.file, held.name, held.id) ?? [];
    return triedAgain(attempts) ? attempts.map((one) => recordedAttempt(ids.get(caseKey(held))!, one, root)) : [];
  }));
}
