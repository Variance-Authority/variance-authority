/**
 * `@variance-authority/vantage/attach` — the watcher's end.
 *
 * Separate from the entrypoint the run imports, because the two ship to
 * different places: a suite takes {@link openVantage} and a socket it never
 * opens, and a watching process takes a listener it does open. Neither wants the
 * other's half in its install.
 *
 * The medium is `@variance-authority/wire`, unchanged and unextended. A run is
 * simply another participant with something to say, one id per execution and one
 * address to say it on — the only difference from a head is which end is the
 * subject.
 */

import { listen, type Wire } from '@variance-authority/wire/listen';
import { createObservatory, type Observatory, type ObservatoryOptions } from './observatory.js';
import { isVantageReport } from './report.js';

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
  const wire: Wire = await listen(options);
  const observatory = createObservatory({ ...options, address: wire.origin });

  wire.on('run', (test, body) => {
    if (test === undefined || !isVantageReport(body)) return;
    observatory.took(test, body);
  });

  return { address: wire.origin, observatory, close: () => wire.close() };
}
