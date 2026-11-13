/**
 * The attempts of a case out of Jest's assertion result. Beside the reporter
 * and not in it: `jest-reporter.ts` is a published entry, and this is not
 * part of what it publishes.
 */

import { observedAttempt, type ObservedAttempt } from './attempts-record.js';

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
    ...Array.from({ length: count - 1 }, (_, at) => observedAttempt(at + 1, 'failed', reasons[at])),
    observedAttempt(count, test.status, test.failureMessages?.[0]),
  ];
}
