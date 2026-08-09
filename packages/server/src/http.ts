import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  CHURN_PATH,
  CURRENT_PATH,
  FLAKINESS_PATH,
  LAST_CHANGED_PATH,
  OBSERVATIONS_PATH,
  REACH_PATH,
  VALUE_JOURNEY_PATH,
} from '@variance-authority/history';
import {
  HistoryWriteConflict,
  churnFrom,
  currentFrom,
  flakinessFrom,
  journeyFrom,
  lastChangedFrom,
  reachFrom,
  type HistoryBackend,
} from './backend.js';
import { BadRequest, MethodNotAllowed, PayloadTooLarge } from './http-errors.js';
import { asBand, parseCurrentRequest, parseRecordRequest } from './http-parse.js';
import { optionalParam, readBody, requireMethod, requiredParam, windowOf } from './http-request.js';

/**
 * The service, as a socket and five questions.
 *
 * Shaped after `raster`'s `serveRenderer`: `node:http`, JSON in and JSON out, no
 * framework, and no logic of its own beyond transport. What it adds — and the
 * only thing it adds — is that this one is *authenticated*, because a renderer
 * holds nothing and a history holds everything a project's runs ever observed.
 *
 * Three rules govern every response here.
 *
 * **Authentication happens before routing.** A request without a valid token gets
 * 401 whatever it asked for, including a path this service does not serve. The
 * alternative — 404 for unknown paths, 401 for known ones — hands an unauthorised
 * caller a map of the API, and on a query for a specific subject it would answer
 * "that subject exists" to somebody holding no token at all.
 *
 * **A malformed request is a 400 that says what was wrong.** The caller is a CI
 * job or an agent; "Bad Request" sends a person to read this file, and a field
 * name sends them to fix their write.
 *
 * **Nothing is repaired on the way in.** A row with an unparseable timestamp, an
 * unknown band, or a profile `core` has never heard of is refused at the door
 * rather than stored and discovered later, because a bad row that is already in
 * an append-only store cannot be taken out again. The door itself is
 * `http-parse.ts`; the refusals it throws are `http-errors.ts`, and `handle`
 * below is the single place that turns one into a status code.
 */

export interface HistoryServiceOptions {
  readonly backend: HistoryBackend;

  /**
   * The bearer token the operator set.
   *
   * There is exactly one, it is shared, and it carries no identity: the service
   * holds no accounts and everything it stores was produced by the operator's own
   * runs. The token is not "who are you" — it is "is this write attributable to
   * this deployment at all".
   */
  readonly token: string;

  /** `0` binds an ephemeral port, which is what the tests use. */
  readonly port?: number;

  /**
   * Defaults to loopback. A history service that binds every interface the moment
   * it starts is one misconfigured firewall away from being a public record of an
   * unreleased product's internals; making the operator ask for it is one line of
   * configuration against a failure with no symptom.
   */
  readonly host?: string;

  /**
   * Largest write accepted, in bytes. A run over 300 subjects writes a handful of
   * rows at roughly a hundred bytes each, so the default is enormous by design —
   * it is a ceiling on memory held for one unauthenticated-in-the-worst-case
   * socket, not a limit anyone should reach. Exceeding it is a 413 that says so,
   * never a truncated body parsed as far as it went.
   */
  readonly maxBodyBytes?: number;
}

export interface HistoryService {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * The one sentence an unauthenticated caller ever gets.
 *
 * Deliberately identical for a missing token, a wrong token, and a path that does
 * not exist. Any variation between those three is an oracle.
 */
const UNAUTHENTICATED = 'a valid bearer token is required';

export async function serveHistory(options: HistoryServiceOptions): Promise<HistoryService> {
  if (options.token.trim() === '') {
    throw new Error(
      'the history service was given an empty bearer token; a service that accepts every ' +
        'request is not authenticated, and it would hold every observation the operator has ever ' +
        'recorded',
    );
  }

  const expected = fingerprint(options.token);
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  const server = createServer((request, response) => {
    void handle(options.backend, expected, maxBodyBytes, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the history service did not bind a TCP port');
  }

  return {
    url: `http://${options.host ?? '127.0.0.1'}:${address.port}`,
    port: address.port,
    close: () => closeServer(server),
  };
}

async function handle(
  backend: HistoryBackend,
  expected: Buffer,
  maxBodyBytes: number,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!authenticated(request, expected)) {
    // Before the URL is even looked at. See the note on ordering above.
    response.setHeader('www-authenticate', 'Bearer');
    send(response, 401, { error: UNAUTHENTICATED });
    return;
  }

  let url: URL;
  try {
    url = new URL(request.url ?? '/', 'http://history.invalid');
  } catch {
    send(response, 400, { error: `"${request.url ?? ''}" is not a request path` });
    return;
  }

  try {
    await route(backend, maxBodyBytes, url, request, response);
  } catch (error) {
    if (error instanceof BadRequest) {
      send(response, 400, { error: error.message });
      return;
    }
    if (error instanceof PayloadTooLarge) {
      // The rest of the body is still in flight and will never be read, so the
      // connection cannot be reused. Saying so is what lets the client read the
      // explanation before the socket goes away.
      response.setHeader('connection', 'close');
      send(response, 413, { error: error.message });
      return;
    }
    if (error instanceof MethodNotAllowed) {
      response.setHeader('allow', error.allow);
      send(response, 405, { error: error.message });
      return;
    }
    if (error instanceof HistoryWriteConflict) {
      send(response, 409, { error: error.message });
      return;
    }
    // Reported as a failure and never as an empty answer. The client turns a
    // non-2xx into a thrown error precisely so that an unreachable or broken
    // service cannot become the sentence "nothing has drifted".
    send(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function route(
  backend: HistoryBackend,
  maxBodyBytes: number,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const project = optionalParam(url, 'project');

  if (url.pathname === OBSERVATIONS_PATH) {
    requireMethod(request, 'POST');
    const body = parseRecordRequest(await readBody(request, maxBodyBytes));
    await backend.append(body.run, body.observations, body.tokens, body.instabilities);
    // 204: the write left nothing to say. The client treats any body on this
    // route as a shape error rather than guessing at it.
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === CURRENT_PATH) {
    // A read, and still a POST: its argument is a subject list, and three hundred
    // subject ids in a query string is a 414 from a proxy nobody configured
    // (`CurrentRequest`).
    requireMethod(request, 'POST');
    const subjects = parseCurrentRequest(await readBody(request, maxBodyBytes));
    send(response, 200, { observations: await currentFrom(backend, project, subjects) });
    return;
  }

  if (url.pathname === LAST_CHANGED_PATH) {
    requireMethod(request, 'GET');
    const band = optionalParam(url, 'band');
    send(response, 200, {
      observation: await lastChangedFrom(
        backend,
        project,
        requiredParam(url, 'subject'),
        requiredParam(url, 'component'),
        band === undefined ? undefined : asBand(band, 'the `band` parameter'),
      ),
    });
    return;
  }

  if (url.pathname === CHURN_PATH) {
    requireMethod(request, 'GET');
    send(
      response,
      200,
      await churnFrom(backend, project, requiredParam(url, 'component'), windowOf(url)),
    );
    return;
  }

  if (url.pathname === FLAKINESS_PATH) {
    requireMethod(request, 'GET');
    send(
      response,
      200,
      await flakinessFrom(backend, project, requiredParam(url, 'subject'), windowOf(url)),
    );
    return;
  }

  if (url.pathname === VALUE_JOURNEY_PATH) {
    requireMethod(request, 'GET');
    send(
      response,
      200,
      await journeyFrom(backend, project, requiredParam(url, 'token'), windowOf(url)),
    );
    return;
  }

  if (url.pathname === REACH_PATH) {
    requireMethod(request, 'GET');
    send(
      response,
      200,
      await reachFrom(backend, project, requiredParam(url, 'component'), windowOf(url)),
    );
    return;
  }

  send(response, 404, {
    error:
      `no route for ${request.method ?? '?'} ${url.pathname}. This service answers ` +
      `${OBSERVATIONS_PATH}, ${CURRENT_PATH}, ${LAST_CHANGED_PATH}, ${CHURN_PATH}, ` +
      `${FLAKINESS_PATH}, ${VALUE_JOURNEY_PATH} and ${REACH_PATH}; a path from a different API ` +
      'version is a client and service that disagree about the recorded shape',
  });
}

/**
 * Compare tokens by digest, in constant time.
 *
 * Two separate defects are being closed. `===` on strings leaks the length of the
 * common prefix through timing, and `timingSafeEqual` throws outright on
 * differing lengths — which leaks the token's length through a 500. Hashing both
 * sides to a fixed 32 bytes first makes every comparison the same shape whatever
 * arrives.
 */
function authenticated(request: IncomingMessage, expected: Buffer): boolean {
  const header = request.headers.authorization;
  if (header === undefined) return false;

  const match = /^Bearer (.+)$/i.exec(header.trim());
  if (match === null || match[1] === undefined) return false;

  return timingSafeEqual(fingerprint(match[1]), expected);
}

function fingerprint(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function closeServer(server: Server): Promise<void> {
  // `closeAllConnections` matters here in a way it does not for a render server:
  // keep-alive sockets from a finished CI job would otherwise hold the process
  // open long past the point anything is being recorded.
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
