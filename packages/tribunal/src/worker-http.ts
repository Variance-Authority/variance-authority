/**
 * What a request is refused with, how one is read, and how an answer is written.
 *
 * Apart from the routing so that a route reads as a route. The three classes here
 * *are* the status codes — [`worker.ts`](./worker.ts) is the only place they
 * become numbers, and the only place that decides whether a failure was the
 * caller's or the platform's — and the readers below are the vocabulary every
 * route validates in.
 *
 * Each reader refuses rather than defaults, which is not politeness about input.
 * Everything this deployment accepts ends up in D1 or R2, and a row that got in
 * stays in: a field that looked close enough becomes a stored fact that every
 * later query answers confidently and wrongly.
 */

export class BadRequest extends Error {
  override readonly name = 'BadRequest';
}

/** A valid token that is not the one this route wants. Never a 401 and never a 404. */
export class Forbidden extends Error {
  override readonly name = 'Forbidden';
}

export class MethodNotAllowed extends Error {
  override readonly name = 'MethodNotAllowed';
  constructor(
    message: string,
    readonly allow: string,
  ) {
    super(message);
  }
}

export function requireMethod(request: Request, method: string): void {
  if (request.method === method) return;
  throw new MethodNotAllowed(
    `this path is answered over ${method}, not ${request.method}`,
    method,
  );
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export async function asRecordBody(request: Request): Promise<Readonly<Record<string, unknown>>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch (error) {
    throw new BadRequest(
      `the request body is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return record(parsed, 'the request body');
}

export function record(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequest(`${what} must be an object; received ${describe(value)}`);
  }
  return value as Readonly<Record<string, unknown>>;
}

export function string(
  source: Readonly<Record<string, unknown>>,
  key: string,
  what: string,
): string {
  const value = source[key];
  if (typeof value !== 'string' || value === '') {
    throw new BadRequest(`${what}.${key} must be a non-empty string; received ${describe(value)}`);
  }
  return value;
}

export function required(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (value === null || value === '') {
    throw new BadRequest(`\`${name}\` is required on ${url.pathname}`);
  }
  return value;
}

export function optional(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value === '' ? undefined : value;
}

export function count(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequest(`a count must be a whole number of at least 0; received "${value}"`);
  }
  return parsed;
}

export function array(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new BadRequest(`${what} must be an array; received ${describe(value)}`);
  }
  return value as readonly unknown[];
}

export function instant(
  source: Readonly<Record<string, unknown>>,
  key: string,
  what: string,
): string {
  const value = string(source, key, what);
  if (Number.isNaN(Date.parse(value))) {
    throw new BadRequest(
      `${what}.${key} must be an ISO-8601 instant; received "${value}". A row whose time cannot ` +
        'be parsed orders a journey wrongly, and a journey read backwards is a confident sentence ' +
        'that is exactly reversed',
    );
  }
  return value;
}

export function flag(
  source: Readonly<Record<string, unknown>>,
  key: string,
  what: string,
): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    throw new BadRequest(`${what}.${key} must be a boolean; received ${describe(value)}`);
  }
  return value;
}

export function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  return `${typeof value} (${String(value).slice(0, 60)})`;
}
