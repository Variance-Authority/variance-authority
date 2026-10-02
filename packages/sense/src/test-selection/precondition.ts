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
 * does nothing, in Node and in a browser realm alike. A recorder that throws is
 * swallowed: a bug in recording may not become a failing test.
 *
 * A named precondition never selects or excludes a test. Nothing in a checkout
 * changes it, so it is read, never diffed.
 */

/** Where a recording listens; mirrors `PRECONDITION` in `case-preconditions.cts`. */
const PRECONDITION = Symbol.for('variance-authority.test-selection.precondition');

/** What a precondition holds. A precondition said without a value holds `true`. */
export type PreconditionValue = string | number | boolean;

type Recorder = (named: unknown, value: unknown, called: Error) => void;

/**
 * Say that the running case arranged `name`, holding `value`.
 *
 * Said in the case body, it is the case's. Said in a `describe` callback, its
 * `beforeAll` or its `beforeEach`, it reaches every case of that `describe` and
 * no sibling; at a file's top level, every case of the file. A narrower scope
 * overrides a wider one, and two values said in one scope are recorded as a
 * contradiction.
 */
export function variancePrecondition(name: string, value?: PreconditionValue): void;
/** Say several preconditions at once: `{ flag: 'ff-on', colour: 'green' }`. */
export function variancePrecondition(preconditions: Readonly<Record<string, PreconditionValue>>): void;
export function variancePrecondition(
  named: string | Readonly<Record<string, PreconditionValue>>,
  value?: PreconditionValue,
): void {
  const recorder = (globalThis as { [PRECONDITION]?: Recorder })[PRECONDITION];
  if (typeof recorder !== 'function') return;
  try {
    recorder(named, value, new Error('variancePrecondition'));
  } catch {
    // A recorder's bug may not become a bug in the test it records.
  }
}
