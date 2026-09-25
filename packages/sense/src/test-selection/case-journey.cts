/**
 * `@variance-authority/sense/case-journey` — the id a case hands to whatever it
 * calls across a fence.
 *
 * A case recorded per case owns its crossings in this realm. What it causes in
 * another process — a service it calls over HTTP, a worker, a queue consumer —
 * is recorded there, under whatever id the request carried. This is that id:
 * minted the first time the running case asks, the same for every later ask in
 * the case, and written onto the case's own frame so the fold joins the two
 * after the run. Put it on the request yourself as the
 * `variance-authority-journey` cookie, or let the application's tracing carry
 * it with {@link carryJourneys}; nothing here touches a request.
 *
 * `undefined` outside a case, and in a run that does not record per case.
 * CommonJS so a test file reaches it from inside Jest's sandbox whatever it was
 * compiled to.
 */

import journeyTrace = require('./journey-trace.cjs');
import type { JourneyTrace } from './journey.js';

/** Mirrors `CASE_SCOPE` in `cases.ts`, which a CommonJS file cannot import. */
const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');

/** Mirrors `JOURNEY_COOKIE` in `@variance-authority/wire`. */
const JOURNEY_COOKIE = 'variance-authority-journey';

interface CaseScope {
  journey?: () => string | undefined;
  carry?: (trace: JourneyTrace) => void;
}

const scope = (): CaseScope | undefined =>
  (globalThis as { [key: symbol]: CaseScope | undefined })[CASE_SCOPE];

function caseJourney(): string | undefined {
  return scope()?.journey?.();
}

/**
 * Run every case from here on inside a trace whose id is its journey, so the
 * application's own tracing carries it across every fence it already crosses:
 *
 * ```js
 * // a `setupFilesAfterEnv` file, after the application's `Sentry.init`
 * const { carryJourneys, sentry } = require('@variance-authority/sense/case-journey');
 * carryJourneys(sentry(Sentry));
 * ```
 *
 * The head beyond the fence is handed the same SDK and asks it which trace is
 * running. False in a run that does not record per case, where there is no
 * journey to carry.
 */
function carryJourneys(trace: JourneyTrace): boolean {
  const carry = scope()?.carry;
  if (carry === undefined) return false;
  carry(trace);
  return true;
}

/** The running case's journey as a `Cookie` pair, or `''` outside a case. */
function journeyCookie(): string {
  const journey = caseJourney();
  return journey === undefined ? '' : `${JOURNEY_COOKIE}=${journey}`;
}

export = {
  caseJourney,
  journeyCookie,
  carryJourneys,
  sentry: journeyTrace.sentry,
  openTelemetry: journeyTrace.openTelemetry,
  JOURNEY_COOKIE,
};
