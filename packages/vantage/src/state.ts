/**
 * What a watcher holds about a run, as plain values.
 *
 * Plain because everything above this reads a **snapshot**: an observatory is a
 * mutable thing a socket writes into, and a question about a run must not be
 * answered from a value that changes while the answer is being written. So the
 * store hands out one of these and every reader gets a run that stopped moving.
 */

import type { RecordedEvent } from '@variance-authority/event/collect';

/**
 * One announcement, as the log recorded it.
 *
 * Re-exported because it is half of what a watcher holds: a reader of
 * {@link WatchedTest} needs the type of the things in it, and reaching past this
 * package for it would make every such reader depend on the announcing half too.
 */
export type { RecordedEvent };

/**
 * Where a test got to.
 *
 * `running` is this package's, and the other five are the runner's own words
 * for how a test ended. A watcher that renamed them would be asking a reader to
 * hold two vocabularies for one fact.
 */
export type TestState =
  | 'running'
  | 'passed'
  | 'failed'
  | 'timedOut'
  | 'skipped'
  | 'interrupted';

/** One test, and everything a run said about it. */
export interface WatchedTest {
  /** The runner's id for this test, which is what reports arrived under. */
  readonly id: string;
  readonly title: string;
  /** Repository-relative, so it is the path an agent already has open. */
  readonly file: string;
  readonly project?: string;
  readonly worker: number;
  /** Arrival order in this vantage, from 0. */
  readonly ordinal: number;
  readonly state: TestState;
  /** Everything announced in this execution, in the order it was announced. */
  readonly heard: readonly RecordedEvent[];
  /** Announcements dropped from the front of {@link heard} to stay bounded. */
  readonly forgotten: number;
  /** Work `vaStart` opened and `vaEnd` never closed, exact whatever was dropped. */
  readonly pending: readonly RecordedEvent[];
  /** What the listener knew and a wait could not see. */
  readonly remarks: readonly string[];
  /** How it failed, when it did. */
  readonly error?: string;
}

/** A run, as it stood the moment somebody asked. */
export interface VantageState {
  /**
   * Where reports are taken, so a tool that has nothing to show can say what to
   * set rather than leaving a reader to guess it is broken.
   */
  readonly address?: string;
  /** Newest last, which is the order they were opened in. */
  readonly tests: readonly WatchedTest[];
  /** Tests dropped from the front of {@link tests} to stay bounded. */
  readonly forgotten: number;
}
