/**
 * The run's end: how a suite tells a watcher what it is doing.
 *
 * Told nothing, it is nothing. {@link openVantage} answers `undefined` when the
 * variable is unset or names an address a report may not be sent to, and a suite
 * that never sets it pays a single environment read per worker. That is the same
 * bargain heads make, on purpose: an instrument nobody asked for must not be a
 * cost anybody pays.
 *
 * Fire-and-forget for everything a run *says*. A watcher is an observer and an
 * observer may not break its subject — a run that failed because the thing
 * looking at it went away would be worse than no watcher at all. What is lost
 * when one goes away is a line in a listing somebody is reading, which is a
 * diagnostic in the right process.
 *
 * {@link Vantage.waits} is the one call that does not return immediately, and it
 * keeps that rule rather than breaking it. The run asks and the watcher answers,
 * so the socket direction never reverses; and every way of losing the watcher —
 * gone, restarted, never there — ends the wait rather than extending it. The
 * failure mode of the thing that stops a test is *the test continues*.
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

/** How a wait ended, which is never "it did not". */
export type Waited =
  /** A reader let it go on. */
  | 'continued'
  /** Nobody was watching, so there was never anything to wait for. */
  | 'unwatched'
  /** The watcher went away mid-wait, and nothing is coming. */
  | 'released'
  /** Nobody came within the bound the caller allowed. */
  | 'expired';

/** How long a run is willing to stand still, and how often it asks. */
export interface WaitOptions {
  /**
   * Give up after this long. Defaults to ten minutes.
   *
   * Bounded by default because the thing on the other end is a person or an
   * agent, either of which can walk away, and an unbounded wait turns that into
   * a suite that never finishes. A caller who has arranged for the runner's own
   * timeout to be lifted can pass `Infinity` and mean it.
   */
  readonly timeoutMs?: number;
  /** How often to ask. Defaults to 50ms, which is a loopback round trip. */
  readonly pollMs?: number;
}

/** A run's voice to whoever is watching it, or its cheap absence. */
export interface Vantage {
  readonly opened: (test: string, identity: WatchedTestIdentity) => void;
  readonly heard: (test: string, event: RecordedEvent) => void;
  readonly remarked: (test: string, about: string, sentence: string) => void;
  /** Send what is here now, from a call the spec's author placed. */
  readonly noted: (test: string, at: string, note: string) => void;
  /** Stop here, and answer how the stop ended. */
  readonly waits: (test: string, at: string, options?: WaitOptions) => Promise<Waited>;
  readonly closed: (test: string, state: TestState, error?: string) => void;
}

/**
 * Where a stopped run asks whether it may go on.
 *
 * A `GET`, so it shares the origin reports are posted to and collides with no
 * execution id: the listener separates a reader's surface from a participant's
 * by method, not by path.
 */
export const VANTAGE_WAITING = '/waiting';

/** The path one stopped test asks on. */
export function waitingPath(test: string): string {
  return `${VANTAGE_WAITING}/${encodeURIComponent(test)}`;
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
    noted: (test, at, note) => say(test, { version: VANTAGE_VERSION, kind: 'noted', at, note }),

    waits: async (test, at, options = {}) => {
      const pollMs = options.pollMs ?? 50;
      const timeoutMs = options.timeoutMs ?? 10 * 60_000;
      const deadline = Date.now() + timeoutMs;

      // Said before the first ask, so a reader sees a stopped test in the window
      // between stopping and asking rather than a test that has gone quiet.
      say(test, { version: VANTAGE_VERSION, kind: 'waiting', at });

      for (;;) {
        let go: boolean;
        try {
          const response = await fetch(`${address}${waitingPath(test)}`);
          if (!response.ok) return 'released';
          go = (await response.json()) === true;
        } catch {
          // The watcher is gone. Nothing is coming, and a run that waited for it
          // anyway would be a run broken by its observer.
          return 'released';
        }
        if (go) return 'continued';
        if (Date.now() >= deadline) return 'expired';
        await new Promise((settle) => setTimeout(settle, pollMs));
      }
    },

    closed: (test, state, error) =>
      say(test, {
        version: VANTAGE_VERSION,
        kind: 'closed',
        state,
        ...(error === undefined ? {} : { error }),
      }),
  };
}
