/**
 * `@variance-authority/wire/listen` — the driver's end of the medium.
 *
 * One listener per driver process, and one address per execution. The execution
 * is in the address rather than in the body, so a participant repeats nothing it
 * was told and the driver reads back the key it minted itself: a report cannot
 * claim an execution by writing one down.
 *
 * The same object is also the carrier for realms the driver is inside
 * ({@link Wire.carrier}) — a page it exposes a function to, a server it started
 * in-process. Those never touch the socket, and nothing above here knows which
 * of the two a report came in on.
 *
 * Loopback, because that is the whole of the reach this needs: a suite and the
 * services it drives are on one machine, which is what the cookie already
 * assumes by being same-origin. The port is ephemeral, so nothing is agreed in
 * advance and several workers listen at once without a word between them.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Participant, WireCarrier } from './index.js';
import { WIRE_SINK } from './index.js';

/** The function a driver exposes in a page for the page's carrier to call. */
export const WIRE_REPORT = '__VAW_REPORT__';

/** What a driver does with one report. */
export type WireHandler = (journey: string | undefined, body: unknown) => void;

/** A listening driver. */
export interface Wire {
  /** Where this listener is, with no execution in it yet. */
  readonly origin: string;
  /** Where a participant answering for `journey` should report. */
  readonly addressFor: (journey: string) => string;
  /** The same desk, for a realm this driver is inside rather than talking to. */
  readonly carrier: WireCarrier;
  /** Take one instrument's reports until the returned call gives them up. */
  readonly on: (participant: Participant, handler: WireHandler) => () => void;
  readonly close: () => Promise<void>;
}

export interface ListenOptions {
  /**
   * The interface to listen on. Defaults to `127.0.0.1`, which is what a
   * participant is willing to answer; anything else is refused there rather
   * than here.
   */
  readonly host?: string;
  /**
   * What a reader gets when it asks this listener a question, if anything.
   *
   * Opt-in, and absent everywhere but a watcher. A listener is a place
   * participants report *to*, and a driver that holds its reports in memory
   * nobody else may see is the normal case: heads and event collectors pass
   * nothing here and keep answering `404` to every read, exactly as they did
   * before this existed.
   *
   * The one caller that does pass it has a second audience — an agent asking
   * about a run in flight — and no other way to reach it, because the memory
   * being asked about ends with the process holding it. Returning `undefined`
   * declines a path, so the reader's surface is the handler's to define rather
   * than this module's.
   */
  readonly answer?: (path: string) => unknown;
}

/**
 * Start taking what participants report.
 *
 * A body this reader cannot parse is dropped and answered as a refusal, so a
 * participant that acknowledges its reports learns it lost one. Throwing here
 * instead would take the run out on the observer's behalf, which is the one
 * thing this side may never do.
 */
export async function listen(options: ListenOptions = {}): Promise<Wire> {
  const handlers = new Map<Participant, WireHandler>();

  const deliver = (journey: string | undefined, participant: Participant, body: unknown): boolean => {
    const handler = handlers.get(participant);
    if (handler === undefined) return false;
    handler(journey, body);
    return true;
  };

  const answer = options.answer;

  const server = createServer((request, response) => {
    // Method-separated rather than path-separated, so a reader's surface cannot
    // collide with an execution id a participant reports under. A listener with
    // no `answer` never reaches this branch and a `GET` falls through to a body
    // that will not parse, which is the `404` it already was.
    if (request.method === 'GET' && answer !== undefined) {
      const asked = new URL(request.url ?? '/', 'http://localhost').pathname;
      const said = answer(asked);
      if (said === undefined) {
        response.writeHead(404).end();
        return;
      }
      const body = JSON.stringify(said);
      response
        .writeHead(200, {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        })
        .end(body);
      return;
    }

    take(request, (body) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname.split('/');
      const journey = decodeURIComponent(path[1] ?? '');
      const participant = decodeURIComponent(path[2] ?? '') as Participant;
      let taken = false;
      try {
        taken = journey.length > 0 && deliver(journey, participant, JSON.parse(body));
      } catch {
        taken = false;
      }
      response.writeHead(taken ? 204 : 404).end();
    });
  });

  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((settle) => server.listen(0, host, settle));
  // A listener is not a reason for a process to stay alive: a run that has
  // finished should exit whether or not a participant is still talking.
  server.unref();

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const origin = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;

  return {
    origin,
    addressFor: (journey) => `${origin}/${encodeURIComponent(journey)}`,
    carrier: (journey, participant, body) => {
      if (!deliver(journey, participant, body)) {
        throw new Error(`nothing here takes what ${participant} reports`);
      }
    },
    on: (participant, handler) => {
      handlers.set(participant, handler);
      return () => {
        if (handlers.get(participant) === handler) handlers.delete(participant);
      };
    },
    close: () => close(server),
  };
}

/**
 * Put a carrier in this process, for a subject the driver is running inside.
 *
 * The returned call gives the global back. Same shape as the page's carrier and
 * the same reports arrive, which is the point: a suite that starts its server
 * in-process configures nothing and loses nothing.
 */
export function installCarrier(carrier: WireCarrier): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, WIRE_SINK);
  Object.defineProperty(globalThis, WIRE_SINK, { configurable: true, value: carrier });
  return () => {
    if (previous === undefined) delete (globalThis as Record<string, unknown>)[WIRE_SINK];
    else Object.defineProperty(globalThis, WIRE_SINK, previous);
  };
}

/**
 * Source that installs the page's carrier, for a driver to evaluate before
 * navigation.
 *
 * A string because it has to run before the application does, in a realm with no
 * module graph yet. The exposed channel is read at report time rather than
 * captured at install time, so the two halves may be installed in either order,
 * and anything said before the channel exists is held rather than dropped — the
 * first decision of the first script is exactly the one a test most wants.
 *
 * The id comes off the document's own cookie, so a page reports under the same
 * execution a service behind it reports under.
 */
export function wireCarrierSource(): string {
  return `(() => {
  const held = [];
  const journey = () => {
    const found = /(?:^|;\\s*)variance-authority-journey=([^;]*)/.exec(globalThis.document?.cookie ?? '');
    return found === null ? undefined : decodeURIComponent(found[1]);
  };
  globalThis[${JSON.stringify(WIRE_SINK)}] = (id, participant, body) => {
    const report = globalThis[${JSON.stringify(WIRE_REPORT)}];
    const said = { journey: id ?? journey(), participant, body };
    if (typeof report !== 'function') {
      held.push(said);
      return;
    }
    while (held.length > 0) report(held.shift());
    return report(said);
  };
})();`;
}

/** The whole body, as text. */
function take(request: IncomingMessage, then: (body: string) => void): void {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => then(Buffer.concat(chunks).toString('utf8')));
  request.on('error', () => then(''));
}

/**
 * Stop listening, without waiting for a participant that is mid-sentence.
 *
 * `server.close()` waits for open connections, and a participant that keeps one
 * alive between reports would hold a worker's teardown for as long as it feels
 * like. What is being closed is a channel nobody is reading any more.
 */
async function close(server: Server): Promise<void> {
  await new Promise<void>((settle) => {
    server.closeAllConnections();
    server.close(() => settle());
  });
}
