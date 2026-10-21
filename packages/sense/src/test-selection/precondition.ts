/**
 * Say what state a test case arranged, so the recording carries it per case.
 *
 * A case that mocks the network, turns a flag on or seeds a cart leaves no
 * trace of it in what a recording reads off the code it ran. Said here, the
 * state lands on the case's row: `variance covering --where network:upsell=mocked`
 * finds the cases that arranged it.
 *
 * The entry imports nothing. It reads one function a recording installs on the
 * realm and calls it; without a recording the call costs one property read and
 * does nothing, in Node and in a browser realm alike. A precondition belongs to
 * a case, so a call where no case is running — a `describe` callback, a
 * `beforeAll`, a file's top level, work that outlives its case — throws. Any
 * other error a recorder throws is swallowed: a bug in recording may not become
 * a failing test.
 *
 * A named precondition never selects or excludes a test. Nothing in a checkout
 * changes it, so it is read, never diffed.
 */

/** Where a recording listens; mirrors `PRECONDITION` in `case-preconditions.cts`. */
const PRECONDITION = Symbol.for('variance-authority.test-selection.precondition');
/**
 * Marks a call that is the test's mistake — made where no case runs, or under
 * a dimension holding `:`; mirrors `MISPLACED` in `case-preconditions.cts`.
 */
const MISPLACED = Symbol.for('variance-authority.test-selection.precondition.misplaced');

type Recorder = (dimension: unknown, record: unknown, called: Error) => void;

/**
 * Say what the running case arranged under one dimension:
 * `variancePrecondition('flags', flags)`, `variancePrecondition('network', { upsell: 'mocked' })`.
 *
 * The dimension is the caller's string, declared nowhere, and may not hold
 * `:`: each key is named `dimension:key`, and a value is recorded as its JSON
 * text — one JSON cannot hold as unrecorded. Said in the case body, or in a
 * `beforeEach` running for the case, it is the case's. Within one dimension the
 * body overrides a `beforeEach`, and an inner `describe`'s `beforeEach` an
 * outer one's, key by key; two values said at one level are recorded as a
 * contradiction. Said where no case is running, it throws.
 *
 * The call hands the record to the recording's listener, with an error whose
 * stack names the call site; without a recording, it returns. The listener's
 * error reaches the test only when it says no case is running.
 *
 * @see https://variance-authority.dev/docs/case-preconditions#what-varianceprecondition-takes
 */
export function variancePrecondition(dimension: string, record: Readonly<Record<string, unknown>>): void {
  const recorder = (globalThis as { [PRECONDITION]?: Recorder })[PRECONDITION];
  if (typeof recorder !== 'function') return;
  try {
    recorder(dimension, record, new Error('variancePrecondition'));
  } catch (thrown) {
    // A recorder's bug may not become a bug in the test it records; a call
    // where no case runs, or a dimension holding `:`, is the test's.
    if ((thrown as { [MISPLACED]?: unknown } | null)?.[MISPLACED] === true) throw thrown;
  }
}
