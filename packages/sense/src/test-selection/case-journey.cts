/**
 * `@variance-authority/sense/case-journey` — the id a case hands to whatever it
 * calls across a fence.
 *
 * A case recorded per case owns its crossings in this realm. What it causes in
 * another process — a service it calls over HTTP, a worker, a queue consumer —
 * is recorded there, under whatever id the request carried. This is that id:
 * minted the first time the running case asks, the same for every later ask in
 * the case, and written onto the case's own frame so the fold joins the two
 * after the run. Put it on the request yourself, as the
 * `variance-authority-journey` cookie or in trace baggage; nothing here touches
 * a request.
 *
 * `undefined` outside a case, and in a run that does not record per case.
 * CommonJS so a test file reaches it from inside Jest's sandbox whatever it was
 * compiled to.
 */

/** Mirrors `CASE_SCOPE` in `cases.ts`, which a CommonJS file cannot import. */
const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');

/** Mirrors `JOURNEY_COOKIE` in `@variance-authority/wire`. */
const JOURNEY_COOKIE = 'variance-authority-journey';

function caseJourney(): string | undefined {
  const scope = (globalThis as { [key: symbol]: { journey?: () => string | undefined } | undefined })[CASE_SCOPE];
  return scope?.journey?.();
}

/** The running case's journey as a `Cookie` pair, or `''` outside a case. */
function journeyCookie(): string {
  const journey = caseJourney();
  return journey === undefined ? '' : `${JOURNEY_COOKIE}=${journey}`;
}

export = { caseJourney, journeyCookie, JOURNEY_COOKIE };
