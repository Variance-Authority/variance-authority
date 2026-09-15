/**
 * What a run says while it is running.
 *
 * Six sentences, and none of them names the test. The execution is in the
 * address a report arrives on, exactly as it is for every other participant on
 * this wire (`@variance-authority/wire`): a body that named its own test could
 * claim one, and a watcher that believed it would attribute an announcement to
 * whichever test the body asked for.
 *
 * Versioned because the two ends are separately installed. A suite pinned a
 * minor behind the watcher it reports to is the ordinary case, not the
 * exceptional one, and a watcher drops what it cannot read rather than
 * half-reading it.
 */

import type { RecordedEvent } from '@variance-authority/event/collect';
import type { TestState } from './state.js';

/** The only version a watcher takes. */
export const VANTAGE_VERSION = 1;

interface Said {
  readonly version: 1;
}

/** A test started. */
export interface TestOpened extends Said {
  readonly kind: 'opened';
  readonly title: string;
  readonly file: string;
  readonly project?: string;
  readonly worker: number;
}

/** A realm announced something in this test's execution. */
export interface TestHeard extends Said {
  readonly kind: 'heard';
  readonly event: RecordedEvent;
}

/** The listener knows something a wait cannot see. */
export interface TestRemarked extends Said {
  readonly kind: 'remarked';
  readonly about: string;
  readonly sentence: string;
}

/**
 * The test sent what is here now, from a call its author placed.
 *
 * Distinct from {@link TestRemarked}, which is the *listener* saying something a
 * wait could not see. This is the test's own voice, at a point in the spec
 * somebody chose, and it accumulates rather than replacing: two calls at two
 * points are two facts about where the execution went, and a keyed last-write
 * would keep only the second.
 */
export interface TestNoted extends Said {
  readonly kind: 'noted';
  /** Where in the spec the call sits, for a reader who has the file open. */
  readonly at: string;
  readonly note: string;
}

/**
 * The test stopped at one of those points and is waiting to be told to go on.
 *
 * Reported rather than inferred from the poll that follows it, so a watcher
 * knows a test is waiting even in the window before its first ask arrives, and
 * so the reason a test has stopped moving is a fact it stated rather than one
 * read out of its silence.
 */
export interface TestWaiting extends Said {
  readonly kind: 'waiting';
  readonly at: string;
}

/** A test ended, however it ended. */
export interface TestClosed extends Said {
  readonly kind: 'closed';
  readonly state: TestState;
  readonly error?: string;
}

/** One thing a run said about one test. */
export type VantageReport =
  | TestOpened
  | TestHeard
  | TestRemarked
  | TestNoted
  | TestWaiting
  | TestClosed;

const KINDS = new Set(['opened', 'heard', 'remarked', 'noted', 'waiting', 'closed']);

/**
 * Whether a body off the wire is one of these.
 *
 * Shape only, and deliberately shallow: what this guards against is a version
 * this watcher predates and a participant that is not this one, both of which
 * are visible in two fields. Validating further would turn a report written by
 * a slightly newer suite into silence, which is the failure this whole package
 * exists to stop producing.
 */
export function isVantageReport(body: unknown): body is VantageReport {
  if (typeof body !== 'object' || body === null) return false;
  const said = body as { version?: unknown; kind?: unknown };
  return said.version === VANTAGE_VERSION && typeof said.kind === 'string' && KINDS.has(said.kind);
}
