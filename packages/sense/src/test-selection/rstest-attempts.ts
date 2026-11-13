/**
 * The attempts of a case out of Rstest's test result, split from `rstest.ts`
 * for its size.
 */

import { observedAttempt, type Failure, type ObservedAttempt } from './attempts-record.js';

/** The fields of an Rstest test result that count its attempts. */
export interface RstestAttempts {
  readonly status: string;
  readonly retryCount?: number;
  readonly errors?: readonly (Failure & object)[];
  readonly retryErrors?: readonly (Failure & object)[];
}

/** Rstest's word for how a case ended, spelled as the other runners spell it. */
const ENDED: Readonly<Record<string, string>> = { pass: 'passed', fail: 'failed', skip: 'skipped' };

/**
 * Rstest counts the retries it spent and reports the last attempt. An earlier
 * attempt failed, because Rstest retries nothing else; its error carries the
 * retry it came from. `duration` is all the attempts together, so none is
 * timed, and a limit and a failure are both `fail`.
 *
 * Under `repeats` the count is every repeat's retries added up and each
 * repeat numbers its errors from 0 again, and nothing in the result says the
 * case was repeated. So the count is trusted only when it reads as one run of
 * retries: every attempt that failed has an error of its own number. A case
 * whose count does not has no attempts. A repeat that passed at once leaves
 * nothing in the result, and is no attempt here.
 */
export function rstestAttempts(test: RstestAttempts): readonly ObservedAttempt[] | undefined {
  const retries = test.retryCount;
  if (typeof retries !== 'number' || !Number.isInteger(retries) || retries < 0) return undefined;
  const errors = [...(test.retryErrors ?? []), ...(test.errors ?? [])] as readonly { readonly retryCount?: number }[];
  const failure = (at: number): Failure => errors.find((error) => (error.retryCount ?? retries) === at) as Failure;
  const ended = ENDED[test.status] ?? test.status;
  const failed = ended === 'failed' ? retries + 1 : retries;
  if (retries > 0 && Array.from({ length: failed }, (_, at) => failure(at)).includes(undefined)) return undefined;
  return [
    ...Array.from({ length: retries }, (_, at) => observedAttempt(at + 1, 'failed', failure(at))),
    observedAttempt(retries + 1, ended, ended === 'failed' ? failure(retries) : undefined),
  ];
}
