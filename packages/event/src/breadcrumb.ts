/**
 * Say what the code read, so the recording carries it on the case that ran it.
 *
 * A test can say what it arranged — `variancePrecondition('flags', flags)` —
 * and the claim parts ways with the code whenever the mock does not reach the
 * provider the code reads from. The breadcrumb is the other half: the value a
 * flag, an experiment or a permission held at the moment the code consulted
 * it, laid beside the regions the case entered.
 *
 * It lives here, beside {@link vae}, because it is called from application
 * source and ships with it. It imports nothing and reads one function a
 * recording installs on `globalThis`; without one, the call is one property
 * read and a return. It never throws: a recorder's failure is swallowed, and a
 * misuse is recorded on the case rather than thrown at the code that read.
 */

/** Where a recording listens; mirrors `BREADCRUMB` in sense's `case-preconditions.cts`. */
const BREADCRUMB = Symbol.for('variance-authority.test-selection.breadcrumb');

/**
 * The recording's listener: asked once without a site, it answers `true` when
 * the read is new to its case, and is then handed the `Error` that names it.
 */
type Recorder = (dimension: unknown, key: unknown, value: unknown, called?: Error) => boolean;

const scope = globalThis as typeof globalThis & { [BREADCRUMB]?: Recorder };

/**
 * Record that the code read `key` under `dimension` as `value`, and return
 * `value` unchanged: `if (varianceBreadcrumb('flags', 'new-checkout', flags['new-checkout']))`.
 *
 * The dimension is the caller's string, declared nowhere, and names the key
 * `dimension:key` on the case, as `variancePrecondition` names what a test
 * said; a dimension holding `:` is recorded as a misuse. The value is recorded
 * as its JSON text, and one JSON cannot hold as unrecorded. Each key and value
 * keeps the site of its first read in a case.
 *
 * @see https://variance-authority.dev/docs/case-preconditions
 */
export function varianceBreadcrumb<Value>(dimension: string, key: string, value: Value): Value {
  const recorder = scope[BREADCRUMB];
  if (typeof recorder !== 'function') return value;
  try {
    if (recorder(dimension, key, value) === true) recorder(dimension, key, value, new Error('varianceBreadcrumb'));
  } catch {
    // A recorder's bug may not become a bug in the code it records.
  }
  return value;
}
