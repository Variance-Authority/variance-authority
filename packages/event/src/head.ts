/**
 * Announcements from a process that is not the browser.
 *
 * A service is not a realm: it outlives every subject in the run and answers
 * several at once, so an announcement leaving it has to say *which execution*, or
 * two concurrent tests waiting on the same coordinates each satisfy the other's
 * wait. That key is the journey — the same opaque per-execution id a cookie
 * already carries — and the scope it is held in is async context, for the same
 * reason coverage is: a handler that returns a promise is still inside its
 * execution while that promise is pending, and a time window is not an execution.
 *
 * ## Why a file, and why the driver reads it while the run is still going
 *
 * A test **waits** on these, so a report drained at teardown is worth nothing.
 * The transport is an append-only line per announcement and a driver that reads
 * from where it left off. That costs a poll interval of latency and buys a
 * channel with no port, no protocol and no second process — on one machine, which
 * is where a suite and the service it drives both are.
 *
 * The write is synchronous. Ordering is the only property this file has that a
 * test can rely on, and an async write would hand it back in exchange for
 * microseconds in a path that only exists while a run is watching.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AnnouncedEvent } from './index.js';
import { EVENT_SINK } from './index.js';

/**
 * Where a head writes announcements. Nothing here reads the journey directory:
 * one variable means one thing, and a head may want events without coverage.
 */
export const EVENT_DIRECTORY_VARIABLE = 'VARIANCE_AUTHORITY_EVENTS';

/**
 * What a head calls itself.
 *
 * Deliberately the variable `@variance-authority/sense/journey` reads for the
 * same purpose, so one `env` block names a service once, and deliberately not an
 * import from it: this package is a dependency of *product* source and takes none
 * of its own.
 */
export const EVENT_HEAD_VARIABLE = 'VARIANCE_AUTHORITY_HEAD';

/** One announcement as a head wrote it down. */
export interface HeadEventReport extends AnnouncedEvent {
  readonly version: 1;
  readonly head: string;
  /** Absent when nothing told the head which execution this belonged to. */
  readonly journey?: string;
}

export interface EventCollectorOptions {
  /** Defaults to {@link EVENT_HEAD_VARIABLE}, then `head`. */
  readonly head?: string;
  /**
   * Where announcements are written. Defaults to
   * {@link EVENT_DIRECTORY_VARIABLE}. Absent, nothing is installed and this
   * process announces nothing — which is how the call survives a production
   * build.
   */
  readonly directory?: string;
}

/** A head's voice in a run, or its cheap absence. */
export interface EventCollector {
  /** False when no directory was configured: nothing installed, nothing written. */
  readonly collecting: boolean;
  readonly head: string;
  /**
   * Run `body` as part of `journey`, so everything it announces — including
   * whatever it awaits — names that execution and no other.
   *
   * `undefined` is honest rather than an error: a request the run did not drive
   * announces without a journey, and the driver counts those instead of handing
   * them to whichever test was nearby.
   */
  readonly enter: <Result>(journey: string | undefined, body: () => Result) => Result;
  /** Stop announcing and restore what was on the global before. */
  readonly close: () => void;
}

type Sink = (
  phase: AnnouncedEvent['phase'],
  location: string,
  subject: string,
  action: string,
) => void;

/**
 * Install this process's sink.
 *
 * ```js
 * import { collectEvents } from '@variance-authority/event/collect';
 * import { journeyOf } from '@variance-authority/sense/journey';
 *
 * const events = collectEvents();
 * server.on('request', (request, response) =>
 *   events.enter(journeyOf(request.headers.cookie), () => handle(request, response)));
 * ```
 */
export function collectEvents(options: EventCollectorOptions = {}): EventCollector {
  const head = options.head ?? process.env[EVENT_HEAD_VARIABLE] ?? 'head';
  const directory = options.directory ?? process.env[EVENT_DIRECTORY_VARIABLE];
  if (directory === undefined) {
    return { collecting: false, head, enter: (_journey, body) => body(), close: () => {} };
  }

  const store = new AsyncLocalStorage<string>();
  const file = join(directory, `events-${head}-${process.pid}.ndjson`);
  const previous = Object.getOwnPropertyDescriptor(globalThis, EVENT_SINK);
  let made = false;

  const sink: Sink = (phase, location, subject, action) => {
    const journey = store.getStore();
    const report: HeadEventReport = {
      version: 1,
      head,
      ...(journey === undefined ? {} : { journey }),
      phase,
      location,
      subject,
      action,
    };
    if (!made) {
      mkdirSync(directory, { recursive: true });
      made = true;
    }
    appendFileSync(file, `${JSON.stringify(report)}\n`);
  };

  Object.defineProperty(globalThis, EVENT_SINK, { configurable: true, value: sink });

  return {
    collecting: true,
    head,
    enter: (journey, body) => (journey === undefined ? body() : store.run(journey, body)),
    close: () => {
      if (previous === undefined) delete (globalThis as Record<string, unknown>)[EVENT_SINK];
      else Object.defineProperty(globalThis, EVENT_SINK, previous);
    },
  };
}

/** A running read of a report directory. */
export interface EventWatch {
  /** Read whatever has landed since the last look, without waiting for a tick. */
  readonly poll: () => void;
  readonly close: () => void;
}

export interface WatchOptions {
  /**
   * How often the directory is looked at, in milliseconds. Defaults to 25.
   *
   * It is the latency a wait pays and nothing else: a poll that misses an
   * announcement finds it on the next tick, because the file it reads is
   * append-only and the reader remembers its own offset.
   */
  readonly intervalMs?: number;
}

/**
 * Read a head's announcements as they land, from a driver.
 *
 * Every complete line since the last look, in file order, once each. A line that
 * is still being written is not a line yet and is left for the next look, which
 * is the whole of the concurrency protocol between the two processes.
 */
export function watchEventReports(
  directory: string,
  onReport: (report: HeadEventReport) => void,
  options: WatchOptions = {},
): EventWatch {
  const consumed = new Map<string, number>();

  const poll = (): void => {
    let names: readonly string[];
    try {
      names = readdirSync(directory);
    } catch {
      // A directory nothing has written to yet is not an error: it is a head
      // that has announced nothing, which is a thing a run is allowed to be.
      return;
    }
    for (const name of names) {
      if (!name.startsWith('events-') || !name.endsWith('.ndjson')) continue;
      const file = join(directory, name);
      const from = consumed.get(name) ?? 0;
      let content: Buffer;
      try {
        if (statSync(file).size <= from) continue;
        content = readFileSync(file);
      } catch {
        continue;
      }
      const complete = content.lastIndexOf(10) + 1;
      if (complete <= from) continue;
      consumed.set(name, complete);
      for (const line of content.subarray(from, complete).toString('utf8').split('\n')) {
        if (line.length === 0) continue;
        try {
          onReport(JSON.parse(line) as HeadEventReport);
        } catch {
          // A line this reader cannot parse came from another version of this
          // package. Skipping it loses one announcement; throwing here would
          // lose the run, in the driver, on the observer's behalf.
        }
      }
    }
  };

  poll();
  const timer = setInterval(poll, options.intervalMs ?? 25);
  timer.unref();
  return { poll, close: () => clearInterval(timer) };
}
