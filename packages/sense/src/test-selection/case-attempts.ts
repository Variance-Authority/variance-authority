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

import { parseStackFrames } from '@variance-authority/core/attribute';
import { recordedAttempt, retriedAttempts, type ObservedAttempt, type RecordedAttempt } from './attempts-record.js';
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
  return tried === undefined ? undefined : retriedAttempts(cases.flatMap((held) =>
    (tried(held.file, held.name, held.id) ?? []).map((one) => recordedAttempt(ids.get(caseKey(held))!, one, root))));
}

/** A failure as a runner serialises it. Jest hands one string, message and stack together. */
type Failure = string | { readonly message?: unknown; readonly stack?: unknown } | null | undefined;

function attempt(attempt: number, ended: string, failure?: Failure, duration?: unknown): ObservedAttempt {
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
  const stack = typeof failure === 'string' ? failure : text(failure?.stack);
  const lines = typeof failure === 'string' ? failure.split('\n') : [];
  const message = typeof failure === 'string'
    ? text(lines.slice(0, lines.findIndex((line) => parseStackFrames(line).length > 0) >>> 0).join('\n'))
    : text(failure?.message);
  return {
    attempt,
    ended,
    ...(typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? { duration: Math.round(duration) } : {}),
    ...(message === undefined ? {} : { message }),
    ...(stack === undefined ? {} : { stack }),
  };
}

/** Vitest's own attempt, structurally: `TestCase.attempts()`, which Vitest before 4.1 does not have. */
export interface VitestAttempt {
  readonly state: string;
  readonly errors?: readonly Failure[] | undefined;
  readonly duration?: number;
}

/**
 * Vitest reports every attempt whole: its state, its errors and its own
 * duration, a repeat counted as an attempt like a retry. An attempt its limit
 * stopped is `failed`, told apart only by its message. Absent from a Vitest
 * whose test case has no `attempts()`.
 */
export function vitestAttempts(reported: Iterable<VitestAttempt> | undefined): readonly ObservedAttempt[] | undefined {
  return reported === undefined
    ? undefined
    : [...reported].map((one, at) => attempt(at + 1, one.state, one.errors?.[0], one.duration));
}

/** The fields of a Jest assertion result that count its attempts. */
export interface JestAttempts {
  readonly status: string;
  readonly invocations?: number;
  readonly failureMessages?: readonly string[] | null;
  readonly retryReasons?: readonly string[];
}

/**
 * Jest counts a case's `invocations` and reports the last one. An earlier one
 * failed, because Jest retries nothing else, and it timed none of them apart:
 * `duration` is the last invocation's. What an earlier one failed with is in
 * `retryReasons`, which Jest fills only under `logErrorsBeforeRetry`, one entry
 * per error: the message is kept when they are one to an attempt. A limit and
 * a failure are both `failed`.
 */
export function jestAttempts(test: JestAttempts): readonly ObservedAttempt[] | undefined {
  const count = test.invocations;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return undefined;
  const reasons = test.retryReasons?.length === count - 1 ? test.retryReasons : [];
  return [
    ...Array.from({ length: count - 1 }, (_, at) => attempt(at + 1, 'failed', reasons[at])),
    attempt(count, test.status, test.failureMessages?.[0]),
  ];
}

/** The fields of an Rstest test result that count its attempts. */
export interface RstestAttempts {
  readonly status: string;
  readonly retryCount?: number;
  readonly errors?: readonly (Failure & object)[];
  readonly retryErrors?: readonly (Failure & object)[];
}

/**
 * Rstest counts the retries it spent and reports the last attempt as `pass` or
 * `fail`, spelled here as the other runners spell them. An earlier attempt
 * failed, because Rstest retries nothing else; its error carries the retry it
 * came from. `duration` is all the attempts together, so none is timed, and a
 * limit and a failure are both `fail`. Under `repeats` the errors of two
 * repeats carry one retry number, and the first is kept.
 */
export function rstestAttempts(test: RstestAttempts): readonly ObservedAttempt[] | undefined {
  const retries = test.retryCount;
  if (typeof retries !== 'number' || !Number.isInteger(retries) || retries < 0) return undefined;
  const errors = [...(test.retryErrors ?? []), ...(test.errors ?? [])] as readonly { readonly retryCount?: number }[];
  const failure = (at: number): Failure => errors.find((error) => (error.retryCount ?? retries) === at) as Failure;
  const ended = test.status === 'pass' ? 'passed' : test.status === 'fail' ? 'failed' : test.status;
  return [
    ...Array.from({ length: retries }, (_, at) => attempt(at + 1, 'failed', failure(at))),
    attempt(retries + 1, ended, ended === 'failed' ? failure(retries) : undefined),
  ];
}
