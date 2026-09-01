/**
 * Announcements from a process that is not the browser.
 *
 * A service is not a realm: it outlives every subject in the run and answers
 * several at once, so an announcement leaving it has to say *which execution*, or
 * two concurrent tests waiting on the same coordinates each satisfy the other's
 * wait. The scope that holds one is async context, for the same reason coverage
 * is scoped that way: a handler that returns a promise is still inside its
 * execution while that promise is pending, and a time window is not an execution.
 *
 * ## Nothing is written down
 *
 * An announcement is a message and not a record. A test **waits** on it, so it is
 * worth something for the length of one execution and nothing afterwards, and a
 * run that ends leaves the disk it found. There is no report directory, no file
 * to clean up and no artifact to mistake for evidence later.
 *
 * How one gets home is not this file's business. `@variance-authority/wire`
 * resolves that from the realm — a carrier the driver installed, or the return
 * address the request carried on a cookie — so the same `collectEvents()` call
 * serves a service in another process and a server the suite started inside
 * itself. Told nothing by either, it announces to nobody, which is what a request
 * the run did not drive should do.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { channelFrom, type Channel } from '@variance-authority/wire';
import type { AnnouncedEvent } from './index.js';
import { EVENT_SINK } from './index.js';

/**
 * Whether this process is under a run at all. Absent, a head installs nothing,
 * and the `collectEvents()` call in a production build costs an `if`.
 *
 * Any value will do — it is a fact about the environment, not a location. The
 * driver reads the same variable to decide whether heads are in play, so one
 * line in a `webServer` env block configures both ends.
 */
export const EVENT_VARIABLE = 'VARIANCE_AUTHORITY_EVENTS';

/**
 * What a head calls itself.
 *
 * Deliberately the variable `@variance-authority/sense/journey` reads for the
 * same purpose, so one `env` block names a service once.
 */
export const EVENT_HEAD_VARIABLE = 'VARIANCE_AUTHORITY_HEAD';

/** One announcement, as it leaves a head. */
export interface HeadEventReport extends AnnouncedEvent {
  readonly version: 1;
  readonly head: string;
}

export interface EventCollectorOptions {
  /** Defaults to {@link EVENT_HEAD_VARIABLE}, then `head`. */
  readonly head?: string;
  /**
   * Whether to install a sink at all. Defaults to whether {@link EVENT_VARIABLE}
   * is set, which is what keeps this call inert everywhere else.
   */
  readonly enabled?: boolean;
}

/** A head's voice in a run, or its cheap absence. */
export interface EventCollector {
  /** False when nothing was installed, and therefore nothing is announced. */
  readonly collecting: boolean;
  readonly head: string;
  /**
   * Run `body` as part of the execution the request belongs to, so everything it
   * announces — including whatever it awaits — reaches that driver and no other.
   *
   * `carried` is the request's `Cookie` header. A head with a cookie accessor of
   * its own may pass the pairs it holds joined the same way; a request that
   * carries neither an execution nor an address is one the run did not drive, and
   * announces to nobody.
   */
  readonly enter: <Result>(carried: string | undefined, body: () => Result) => Result;
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
 *
 * const events = collectEvents();
 * server.on('request', (request, response) =>
 *   events.enter(request.headers.cookie, () => handle(request, response)));
 * ```
 */
export function collectEvents(options: EventCollectorOptions = {}): EventCollector {
  const head = options.head ?? process.env[EVENT_HEAD_VARIABLE] ?? 'head';
  const enabled = options.enabled ?? process.env[EVENT_VARIABLE] !== undefined;
  if (!enabled) {
    return { collecting: false, head, enter: (_carried, body) => body(), close: () => {} };
  }

  const store = new AsyncLocalStorage<Channel>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, EVENT_SINK);

  const sink: Sink = (phase, location, subject, action) => {
    const channel = store.getStore();
    // Announcements are the half of this wire that is allowed to disappear: a
    // lost one is a wait that times out in the driver and prints what it did
    // hear, which is a diagnostic in the right process.
    channel?.report('events', { version: 1, head, phase, location, subject, action });
  };

  Object.defineProperty(globalThis, EVENT_SINK, { configurable: true, value: sink });

  return {
    collecting: true,
    head,
    enter: (carried, body) => {
      const channel = channelFrom(carried);
      return channel === undefined ? body() : store.run(channel, body);
    },
    close: () => {
      if (previous === undefined) delete (globalThis as Record<string, unknown>)[EVENT_SINK];
      else Object.defineProperty(globalThis, EVENT_SINK, previous);
    },
  };
}
