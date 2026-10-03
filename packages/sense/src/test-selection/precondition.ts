/**
 * Say what state a test case arranged, so the recording carries it per case.
 *
 * A case that mocks the network, turns a flag on or seeds a cart leaves no
 * trace of it in what a recording reads off the code it ran. Said here, the
 * state lands on the case's row: `variance covering --where network=mocked`
 * finds the cases that arranged it, and a name `names.axes` declares finds each
 * case's twin one step along the axis.
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
/** Marks a call made where no case runs; mirrors `MISPLACED` in `case-preconditions.cts`. */
const MISPLACED = Symbol.for('variance-authority.test-selection.precondition.misplaced');

/** What a precondition holds. */
export type PreconditionValue = string | number | boolean;

type Recorder = (named: unknown, value: unknown, called: Error) => void;

/**
 * Say what the running case arranged: `{ network: 'mocked', 'seeded-cart': true }`.
 *
 * Said in the case body, or in a `beforeEach` running for the case, it is the
 * case's. The body overrides a `beforeEach`, and an inner `describe`'s
 * `beforeEach` an outer one's; two values said at one level are recorded as a
 * contradiction. Said where no case is running, it throws.
 *
 * The call hands the record to the recording's listener, with an error whose
 * stack names the call site; without a recording, it returns. The listener's
 * error reaches the test only when it says no case is running.
 */
export function variancePrecondition(preconditions: Readonly<Record<string, PreconditionValue>>): void {
  const recorder = (globalThis as { [PRECONDITION]?: Recorder })[PRECONDITION];
  if (typeof recorder !== 'function') return;
  try {
    recorder(preconditions, undefined, new Error('variancePrecondition'));
  } catch (thrown) {
    // A recorder's bug may not become a bug in the test it records; a call
    // where no case runs is the test's.
    if ((thrown as { [MISPLACED]?: unknown } | null)?.[MISPLACED] === true) throw thrown;
  }
}
