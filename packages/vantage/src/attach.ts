/**
 * `@variance-authority/vantage/attach` — the watcher's end.
 *
 * Separate from the entrypoint the run imports, because the two ship to
 * different places: a suite takes {@link openVantage} and a socket it never
 * opens, and a watching process takes a listener it does open. Neither wants the
 * other's half in its install.
 *
 * The medium is `@variance-authority/wire`. A run is simply another participant
 * with something to say, one id per execution and one address to say it on — the
 * only difference from a head is which end is the subject.
 *
 * This is the one listener in the system that also answers. A watcher exists to
 * be asked, and what it holds ends with the process holding it, so a reader in
 * another process has no file to open and no second chance later. The reading
 * side is a `GET` on the same origin the run reports to, which is why there is
 * one address here and not two: the string an agent already had to set for the
 * suite is the string it asks on.
 */

import { listen, type Wire } from '@variance-authority/wire/listen';
import { createObservatory, type Observatory, type ObservatoryOptions } from './observatory.js';
import { isVantageReport } from './report.js';
import type { VantageState } from './state.js';

/**
 * Where a reader asks, on the origin a run reports to.
 *
 * A constant rather than a convention, because the two ends are in different
 * packages and a path spelled twice is a path that will be spelled differently
 * once. Root, because a report always carries an execution id in its path and
 * therefore never lands here.
 */
export const VANTAGE_ASK = '/';

/**
 * One reading of a watcher, and the reading handed out before it.
 *
 * `previous` is what makes progress askable: the useful question about a suite
 * in flight is not only what it is doing but what it has done since the last
 * time anybody looked. It is the same state a connection holds for one client,
 * kept here instead because the reader is a process that exits between
 * questions and cannot hold anything itself.
 */
export interface VantageReading {
  readonly state: VantageState;
  readonly previous?: VantageState;
}

export interface AttachOptions extends ObservatoryOptions {
  /** The interface to listen on. Defaults to `127.0.0.1`, which is all a run will answer. */
  readonly host?: string;
}

/** A listening watcher, and what it has been told. */
export interface AttachedVantage {
  /** What a run must be started with, verbatim. */
  readonly address: string;
  readonly observatory: Observatory;
  readonly close: () => Promise<void>;
}

/**
 * Listen for a run.
 *
 * `address` is derived rather than configured: the port is ephemeral, so a
 * second watcher on the same machine needs no coordination with the first, and
 * the only thing anybody has to carry is the one string this returns.
 */
export async function attachVantage(options: AttachOptions = {}): Promise<AttachedVantage> {
  // Read before the listener exists, so the address the observatory reports is
  // the one the reader will be told, and not a second one assembled later.
  let previous: VantageState | undefined;

  const answer = (path: string): VantageReading | undefined => {
    if (path !== VANTAGE_ASK) return undefined;
    const state = observatory.snapshot();
    const reading: VantageReading = previous === undefined ? { state } : { state, previous };
    // Rotated by the reading rather than by the answer it produces, because the
    // reader is in another process and cannot come back to say it succeeded.
    // One `previous` is shared by every reader of this watcher, which is the
    // same bargain one MCP connection makes for its one client.
    previous = state;
    return reading;
  };

  const wire: Wire = await listen({ ...options, answer });
  const observatory = createObservatory({ ...options, address: wire.origin });

  wire.on('run', (test, body) => {
    if (test === undefined || !isVantageReport(body)) return;
    observatory.took(test, body);
  });

  return { address: wire.origin, observatory, close: () => wire.close() };
}
