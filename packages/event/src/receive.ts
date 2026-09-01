/**
 * The address a head answers to, held open for as long as a run is listening.
 *
 * One loopback listener per driver process, and a path per execution. The
 * execution's id is in the address rather than in the body, so a head repeats
 * nothing it was told and the driver reads the key it minted itself — a report
 * cannot claim an execution by writing one down.
 *
 * Loopback because that is the whole of the reach this needs: a suite and the
 * services it drives are on one machine, which is the same assumption the cookie
 * already makes by being same-origin. The port is ephemeral, so nothing has to be
 * agreed in advance and several workers listen at once without a word between
 * them.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { HeadEventReport } from './head.js';

/** A listening driver, and the address it hands to one execution. */
export interface EventReceiver {
  /** Where a head announcing for `journey` should answer. */
  readonly endpointFor: (journey: string) => string;
  readonly close: () => Promise<void>;
}

export interface ReceiverOptions {
  /**
   * The interface to listen on. Defaults to `127.0.0.1`, which a head is willing
   * to answer; anything else is refused there rather than here.
   */
  readonly host?: string;
}

/**
 * Start listening for what heads announce.
 *
 * `onReport` is called with the execution the address belonged to, in the order
 * a head sent its announcements. A body this reader cannot parse is dropped: it
 * came from another version of this package, and losing one announcement is a
 * failing wait that prints what it heard, where throwing here would take the run
 * out on the observer's behalf.
 */
export async function receiveEvents(
  onReport: (journey: string, report: HeadEventReport) => void,
  options: ReceiverOptions = {},
): Promise<EventReceiver> {
  const server = createServer((request, response) => {
    take(request, (body) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const journey = decodeURIComponent(path.slice(1));
      response.writeHead(204).end();
      if (journey.length === 0) return;
      try {
        onReport(journey, JSON.parse(body) as HeadEventReport);
      } catch {
        // Deliberately nothing. See above.
      }
    });
  });

  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((settle) => server.listen(0, host, settle));
  // A listener is not a reason for a process to stay alive. A run that has
  // finished should exit whether or not a head is still talking.
  server.unref();

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const origin = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;

  return {
    endpointFor: (journey) => `${origin}/${encodeURIComponent(journey)}`,
    close: () => close(server),
  };
}

/** The whole body, as text. */
function take(request: IncomingMessage, then: (body: string) => void): void {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => then(Buffer.concat(chunks).toString('utf8')));
  request.on('error', () => then(''));
}

/**
 * Stop listening, without waiting for a head that is mid-sentence.
 *
 * `server.close()` waits for open connections, and a head that keeps one alive
 * between announcements would hold a worker's teardown for as long as it feels
 * like. What is being closed is a channel nobody is reading any more.
 */
async function close(server: Server): Promise<void> {
  await new Promise<void>((settle) => {
    server.closeAllConnections();
    server.close(() => settle());
  });
}
