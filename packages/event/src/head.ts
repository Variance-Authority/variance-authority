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
 * ## Nothing is written down
 *
 * An announcement is a message and not a record. A test **waits** on it, so it is
 * worth something for the length of one execution and nothing afterwards, and a
 * run that ends leaves the disk it found. There is no report directory, no file
 * to clean up and no artifact to mistake for evidence later.
 *
 * The channel is the cookie the driver already sets. Beside the journey it
 * leaves a **return address** — a loopback URL that belongs to one execution —
 * and a head answers to it as it announces. So the head learns where to speak
 * from the request it is already serving, which is the same trick that carries
 * the journey: no port to agree on, no configuration per service, and no second
 * transport to keep alive.
 *
 * Only loopback addresses are accepted, and only when this process was told it is
 * under test ({@link EVENT_VARIABLE}). A cookie is written by whoever is talking
 * to the service, and a process that posts wherever a cookie says is a hole
 * rather than an instrument.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { AnnouncedEvent } from './index.js';
import { EVENT_SINK } from './index.js';

/**
 * The cookie a driver leaves its return address on.
 *
 * Beside `variance-authority-journey` rather than inside it: one cookie is one
 * participant's business, and a head that only announces should not have to
 * understand a coverage key to answer.
 */
export const EVENT_COOKIE = 'variance-authority-events';

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
 * same purpose, so one `env` block names a service once, and deliberately not an
 * import from it: this package is a dependency of *product* source and takes none
 * of its own.
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
   * announces — including whatever it awaits — answers to that driver and no
   * other.
   *
   * `address` is the request's `Cookie` header, or the value of the
   * {@link EVENT_COOKIE} cookie if the head has an accessor of its own: anything
   * beginning with `http` is read as the address itself. `undefined` is honest
   * rather than an error — a request the run did not drive has nobody to answer,
   * and announces to nobody.
   */
  readonly enter: <Result>(address: string | undefined, body: () => Result) => Result;
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
    return { collecting: false, head, enter: (_address, body) => body(), close: () => {} };
  }

  const store = new AsyncLocalStorage<string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, EVENT_SINK);
  const sending = new Map<string, Promise<void>>();

  const sink: Sink = (phase, location, subject, action) => {
    const address = store.getStore();
    if (address === undefined) return;
    post(sending, address, { version: 1, head, phase, location, subject, action });
  };

  Object.defineProperty(globalThis, EVENT_SINK, { configurable: true, value: sink });

  return {
    collecting: true,
    head,
    enter: (address, body) => {
      const endpoint = addressIn(address);
      return endpoint === undefined ? body() : store.run(endpoint, body);
    },
    close: () => {
      if (previous === undefined) delete (globalThis as Record<string, unknown>)[EVENT_SINK];
      else Object.defineProperty(globalThis, EVENT_SINK, previous);
    },
  };
}

/**
 * One announcement on its way, behind whatever this endpoint is still sending.
 *
 * Order is the only property of this channel a test can rely on — *started* has
 * to arrive before *ended* — and two overlapping posts do not have it. So they
 * queue per endpoint, which is per execution, and one execution's announcements
 * never wait behind another's.
 *
 * Every failure is swallowed. The observer may not break the subject: a driver
 * that has gone away, a refused connection, a body nobody reads — each of those
 * surfaces where it is legible, as a wait that times out and prints what it did
 * hear, rather than as an exception thrown out of the line that announced.
 */
function post(sending: Map<string, Promise<void>>, endpoint: string, report: HeadEventReport): void {
  const settled = (sending.get(endpoint) ?? Promise.resolve())
    .then(async () => {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
      });
    })
    .catch(() => {});

  sending.set(endpoint, settled);
  void settled.then(() => {
    if (sending.get(endpoint) === settled) sending.delete(endpoint);
  });
}

/**
 * The address to answer, out of whatever the request carried.
 *
 * Loopback only, and http only. The value is written by whoever is talking to
 * this service, so the guard is what keeps an instrument from becoming a way to
 * make the process fetch an address somebody else chose.
 */
function addressIn(address: string | undefined): string | undefined {
  if (address === undefined) return undefined;
  const value = address.startsWith('http') ? address : cookieIn(address);
  if (value === undefined) return undefined;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:') return undefined;
  return LOOPBACK.has(url.hostname) ? url.href : undefined;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** The one cookie this package owns, read out of a `Cookie` header. */
function cookieIn(header: string): string | undefined {
  for (const pair of header.split(';')) {
    const equals = pair.indexOf('=');
    if (equals < 0) continue;
    if (pair.slice(0, equals).trim() !== EVENT_COOKIE) continue;
    const value = pair.slice(equals + 1).trim();
    return value.length === 0 ? undefined : decodeURIComponent(value);
  }
  return undefined;
}
