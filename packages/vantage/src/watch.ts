/**
 * The run's end: how a suite tells a watcher what it is doing.
 *
 * Told nothing, it is nothing. {@link openVantage} answers `undefined` when the
 * variable is unset or names an address a report may not be sent to, and a suite
 * that never sets it pays a single environment read per worker. That is the same
 * bargain heads make, on purpose: an instrument nobody asked for must not be a
 * cost anybody pays.
 *
 * Fire-and-forget, always. A watcher is an observer and an observer may not
 * break its subject — a run that failed because the thing looking at it went
 * away would be worse than no watcher at all. What is lost when one goes away is
 * a line in a listing somebody is reading, which is a diagnostic in the right
 * process.
 */

import type { RecordedEvent } from '@variance-authority/event/collect';
import { channelTo } from '@variance-authority/wire';
import type { VantageReport } from './report.js';
import { VANTAGE_VERSION } from './report.js';
import type { TestState } from './state.js';

/**
 * Where this run reports what it is doing, if anywhere.
 *
 * Loopback only, and the address is the whole of the configuration: a watcher
 * listens on an ephemeral port and says which, so nothing is agreed in advance
 * and two of them never collide.
 */
export const VANTAGE_VARIABLE = 'VARIANCE_AUTHORITY_VANTAGE';

/** What a test's arrival is described by, once. */
export interface WatchedTestIdentity {
  readonly title: string;
  /** Repository-relative, so a reader gets the path they already have open. */
  readonly file: string;
  readonly project?: string;
  readonly worker: number;
}

/** A run's voice to whoever is watching it, or its cheap absence. */
export interface Vantage {
  readonly opened: (test: string, identity: WatchedTestIdentity) => void;
  readonly heard: (test: string, event: RecordedEvent) => void;
  readonly remarked: (test: string, about: string, sentence: string) => void;
  readonly closed: (test: string, state: TestState, error?: string) => void;
}

/**
 * Start reporting, or find that nothing is listening.
 *
 * ```ts
 * const vantage = openVantage();
 * vantage?.opened(testInfo.testId, { title, file, worker: testInfo.workerIndex });
 * ```
 */
export function openVantage(address = process.env[VANTAGE_VARIABLE]): Vantage | undefined {
  if (address === undefined || address === '') return undefined;
  // One probe, so an address that is not loopback is a run that reports nothing
  // rather than one that discovers it per report, per test, for the whole suite.
  if (channelTo(address, 'probe') === undefined) return undefined;

  const say = (test: string, report: VantageReport): void => {
    channelTo(address, test)?.report('run', report);
  };

  return {
    opened: (test, identity) =>
      say(test, {
        version: VANTAGE_VERSION,
        kind: 'opened',
        title: identity.title,
        file: identity.file,
        ...(identity.project === undefined ? {} : { project: identity.project }),
        worker: identity.worker,
      }),
    heard: (test, event) => say(test, { version: VANTAGE_VERSION, kind: 'heard', event }),
    remarked: (test, about, sentence) =>
      say(test, { version: VANTAGE_VERSION, kind: 'remarked', about, sentence }),
    closed: (test, state, error) =>
      say(test, {
        version: VANTAGE_VERSION,
        kind: 'closed',
        state,
        ...(error === undefined ? {} : { error }),
      }),
  };
}
