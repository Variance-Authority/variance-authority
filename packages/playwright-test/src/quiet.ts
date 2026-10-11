/**
 * Draining a page without showing the test a step for it.
 *
 * Playwright reports every API call a test makes while it runs as a step: in
 * the HTML report, the trace, where it also snapshots the DOM around the call,
 * and the inspector, which pauses on it. A drain is the recording's, not the
 * test's, and the cut makes one before every statement, so each would be a
 * step the user never wrote. Playwright marks its own bookkeeping calls
 * internal, which keeps them out of all three; a drain goes through the same
 * door.
 */

/** The door: how Playwright's client runs a call it does not report. */
interface WrapsApiCalls {
  readonly _wrapApiCall: <Result>(call: () => Promise<Result>, options: { readonly internal: boolean }) => Promise<Result>;
}

/**
 * Run `call` as one of Playwright's internal calls on `page`, so every call it
 * makes on the page joins it unreported. A page that is not Playwright's — a
 * test's stand-in — runs it as it is.
 */
export function quietly<Result>(page: object, call: () => Promise<Result>): Promise<Result> {
  const client = page as Partial<WrapsApiCalls>;
  return typeof client._wrapApiCall === 'function' ? client._wrapApiCall(call, { internal: true }) : call();
}
