import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { profileById, type Digest, type ProfileId } from '@variance-authority/core';
import {
  BANDS,
  CHURN_PATH,
  LAST_CHANGED_PATH,
  OBSERVATIONS_PATH,
  REACH_PATH,
  VALUE_JOURNEY_PATH,
  type Band,
  type Observation,
  type RunRecord,
  type TokenValue,
  type Window,
} from '@variance-authority/history';
import {
  HistoryWriteConflict,
  churnFrom,
  journeyFrom,
  lastChangedFrom,
  reachFrom,
  type HistoryBackend,
} from './backend.js';

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
 * an append-only store cannot be taken out again.
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
    await backend.append(body.run, body.observations, body.tokens);
    // 204: the write left nothing to say. The client treats any body on this
    // route as a shape error rather than guessing at it.
    response.writeHead(204).end();
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
      `${OBSERVATIONS_PATH}, ${LAST_CHANGED_PATH}, ${CHURN_PATH}, ${VALUE_JOURNEY_PATH} and ` +
      `${REACH_PATH}; a path from a different API version is a client and service that disagree ` +
      'about the recorded shape',
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

/** A request whose shape is wrong: answered 400, with the field named. */
class BadRequest extends Error {
  override readonly name = 'BadRequest';
}

class PayloadTooLarge extends Error {
  override readonly name = 'PayloadTooLarge';
}

/**
 * The right method on a real route, answered 405 rather than 404.
 *
 * The distinction only exists past authentication, so it reveals nothing; and it
 * is worth keeping, because a `GET` against the write route is a client built
 * against a different version of this API, and 404 would send whoever wrote it
 * looking for a typo in the path.
 */
class MethodNotAllowed extends Error {
  override readonly name = 'MethodNotAllowed';
  constructor(
    message: string,
    readonly allow: string,
  ) {
    super(message);
  }
}

function requireMethod(request: IncomingMessage, method: string): void {
  if (request.method === method) return;
  throw new MethodNotAllowed(
    `${request.url ?? ''} is answered over ${method}, not ${request.method ?? 'an unknown method'}`,
    method,
  );
}

function requiredParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (value === null || value === '') {
    throw new BadRequest(`\`${name}\` is required on ${url.pathname}`);
  }
  return value;
}

function optionalParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value === '' ? undefined : value;
}

/**
 * The window, validated before it can quietly select nothing.
 *
 * An unparseable `since` would bind as NULL and match no row, and the answer
 * would be a churn of zero over zero runs — indistinguishable from a component
 * that has never changed. A limit of zero is refused for the same reason: it is a
 * request for an answer computed over nothing, dressed as an answer.
 */
function windowOf(url: URL): Window {
  const since = optionalParam(url, 'since');
  const until = optionalParam(url, 'until');
  const limit = optionalParam(url, 'limit');

  if (since !== undefined && Number.isNaN(Date.parse(since))) {
    throw new BadRequest(`\`since\` must be an ISO-8601 instant; received "${since}"`);
  }
  if (until !== undefined && Number.isNaN(Date.parse(until))) {
    throw new BadRequest(`\`until\` must be an ISO-8601 instant; received "${until}"`);
  }

  let parsedLimit: number | undefined;
  if (limit !== undefined) {
    parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      throw new BadRequest(
        `\`limit\` must be a whole number of at least 1; received "${limit}". A limit of 0 asks ` +
          'for a drift answer computed over no rows, which reads as stability',
      );
    }
  }

  return {
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
  };
}

/**
 * Read the whole body, or stop and say why.
 *
 * Written with events rather than `for await` because breaking out of an async
 * iteration over a request destroys the stream, and a destroyed request takes the
 * socket with it — the caller would get a connection reset where a 413 explaining
 * itself was the entire point. Here the stream is merely paused; the 413 goes
 * out, and Node closes the connection afterwards because the body was never
 * drained.
 */
async function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const settle = (act: () => void): void => {
      if (settled) return;
      settled = true;
      act();
    };

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        request.pause();
        settle(() => {
          reject(
            new PayloadTooLarge(
              `the request body exceeds ${maxBodyBytes} bytes and was not read. Nothing was ` +
                'stored: a partially read write would record rows without the run that produced them',
            ),
          );
        });
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => settle(() => resolve(Buffer.concat(chunks).toString('utf8'))));
    request.on('error', (error: Error) => settle(() => reject(error)));
  });
}

interface ParsedRecordRequest {
  readonly run: RunRecord;
  readonly observations: readonly Observation[];
  readonly tokens: readonly TokenValue[];
}

/**
 * Validate a write completely before any of it is appended.
 *
 * The store is append-only, so this is the last moment anything can be refused. A
 * row with an unknown band or an unparseable instant that gets in stays in, and
 * every later query over that window either throws or silently misorders — so the
 * strictness here is not politeness about input, it is the only place the
 * invariant can still be enforced.
 */
function parseRecordRequest(body: string): ParsedRecordRequest {
  if (body.trim() === '') {
    throw new BadRequest(
      'the write carried no body; a run with no rows is still recorded, but it has to say which ' +
        'run it was',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new BadRequest(
      `the request body is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const source = asRecord(parsed, 'the request body');

  return {
    run: asRunRecord(source['run']),
    observations: asArray(source['observations'], '`observations`').map((row, index) =>
      asObservation(row, `observations[${index}]`),
    ),
    tokens: asArray(source['tokens'], '`tokens`').map((row, index) =>
      asTokenValue(row, `tokens[${index}]`),
    ),
  };
}

function asRecord(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequest(`${what} must be an object; received ${describe(value)}`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function asArray(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new BadRequest(`${what} must be an array; received ${describe(value)}`);
  }
  return value as readonly unknown[];
}

function text(source: Readonly<Record<string, unknown>>, key: string, what: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value === '') {
    throw new BadRequest(`${what}.${key} must be a non-empty string; received ${describe(value)}`);
  }
  return value;
}

function instant(source: Readonly<Record<string, unknown>>, key: string, what: string): string {
  const value = text(source, key, what);
  if (Number.isNaN(Date.parse(value))) {
    throw new BadRequest(
      `${what}.${key} must be an ISO-8601 instant; received "${value}". A row whose time cannot ` +
        'be parsed orders a journey wrongly, and a journey read backwards is a confident sentence ' +
        'that is exactly reversed',
    );
  }
  return value;
}

function flag(source: Readonly<Record<string, unknown>>, key: string, what: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    throw new BadRequest(`${what}.${key} must be a boolean; received ${describe(value)}`);
  }
  return value;
}

function asBand(value: unknown, what: string): Band {
  if (typeof value !== 'string' || !BANDS.includes(value as Band)) {
    throw new BadRequest(
      `${what} must be one of ${BANDS.join(', ')}; received ${describe(value)}`,
    );
  }
  return value as Band;
}

/**
 * Profiles are checked against `core`'s own table, so a tier added there is
 * accepted here without this file being edited — and a typo is still refused
 * rather than stored as a profile no query will ever match.
 */
function asProfile(value: unknown, what: string): ProfileId {
  const known: unknown = typeof value === 'string' ? profileById(value as ProfileId) : undefined;
  if (known === undefined) {
    throw new BadRequest(`${what}.profile is not a known observation profile: ${describe(value)}`);
  }
  return value as ProfileId;
}

function asRunRecord(value: unknown): RunRecord {
  const what = '`run`';
  const source = asRecord(value, what);

  return {
    project: text(source, 'project', what),
    run: text(source, 'run', what),
    commit: text(source, 'commit', what),
    profile: asProfile(source['profile'], what),
    at: instant(source, 'at', what),
  };
}

function asObservation(value: unknown, what: string): Observation {
  const source = asRecord(value, what);
  const file = source['file'];

  if (file !== undefined && file !== null && typeof file !== 'string') {
    throw new BadRequest(`${what}.file must be a string when present; received ${describe(file)}`);
  }

  return {
    project: text(source, 'project', what),
    subject: text(source, 'subject', what),
    component: text(source, 'component', what),
    band: asBand(source['band'], `${what}.band`),
    hash: text(source, 'hash', what) as Digest,
    profile: asProfile(source['profile'], what),
    commit: text(source, 'commit', what),
    run: text(source, 'run', what),
    at: instant(source, 'at', what),
    accepted: flag(source, 'accepted', what),
    ...(typeof file === 'string' && file !== '' ? { file } : {}),
  };
}

function asTokenValue(value: unknown, what: string): TokenValue {
  const source = asRecord(value, what);

  return {
    project: text(source, 'project', what),
    token: text(source, 'token', what),
    // Not `text`: an empty resolved value is a legitimate reading — a token that
    // resolves to nothing is a change worth recording, and refusing it here would
    // put a hole in a journey that nothing explains.
    value: string(source, 'value', what),
    commit: text(source, 'commit', what),
    at: instant(source, 'at', what),
  };
}

function string(source: Readonly<Record<string, unknown>>, key: string, what: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new BadRequest(`${what}.${key} must be a string; received ${describe(value)}`);
  }
  return value;
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `${typeof value} (${JSON.stringify(value)?.slice(0, 80) ?? ''})`;
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
