import { env } from 'cloudflare:workers';

/**
 * Who the browser is, according to Cloudflare Access.
 *
 * This app draws an approve button, and an approve button reachable by anybody
 * is the one thing a review service must never publish. It has no accounts of
 * its own and will not grow any: identity comes from Access, which is in front
 * of the hostname anyway, and the assertion it forwards is a signed JWT rather
 * than a header a client could set.
 *
 * **The signature is checked.** A deployment's origin can be reached directly if
 * its Worker route is ever exposed beside the Access hostname, and at that point
 * `Cf-Access-Authenticated-User-Email` is a request header like any other. So the
 * JWT is verified against the team's published keys, with its audience compared
 * to this application's own tag — a valid token minted for another app in the
 * same team is refused here.
 *
 * Absent configuration is refusal, never a default: `ACCESS_TEAM_DOMAIN` or
 * `ACCESS_AUD` unset means no review surface at all.
 */

/** What Access puts on the request. The cookie is what a browser navigation carries. */
const HEADER = 'cf-access-jwt-assertion';
const COOKIE = 'CF_Authorization';

interface AccessKey {
  readonly kid: string;
  readonly key: CryptoKey;
}

/** Cached per isolate: the certs endpoint is stable and a fetch per page view is a fetch too many. */
let keys: Promise<readonly AccessKey[]> | undefined;

export interface Identity {
  /** The email Access authenticated. Written on every decision this person makes. */
  readonly email: string;
}

export async function identify(request: Request): Promise<Identity | null> {
  const team = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  if (team === undefined || team === '' || audience === undefined || audience === '') return null;

  const token = tokenOf(request);
  if (token === null) return null;

  const payload = await verify(token, team, audience);
  if (payload === null) return null;

  const email = payload['email'];
  // A service token authenticates a machine and carries `common_name` instead.
  // Machines ingest; they do not decide.
  return typeof email === 'string' && email !== '' ? { email } : null;
}

function tokenOf(request: Request): string | null {
  const header = request.headers.get(HEADER);
  if (header !== null && header !== '') return header;

  const cookies = request.headers.get('cookie') ?? '';
  for (const pair of cookies.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name === COOKIE && rest.length > 0) return rest.join('=');
  }
  return null;
}

async function verify(
  token: string,
  team: string,
  audience: string,
): Promise<Record<string, unknown> | null> {
  const [head, body, signature] = token.split('.');
  if (head === undefined || body === undefined || signature === undefined) return null;

  const header = decode(head);
  const payload = decode(body);
  if (header === null || payload === null) return null;
  if (header['alg'] !== 'RS256') return null;

  const audiences = payload['aud'];
  const matches = Array.isArray(audiences)
    ? audiences.includes(audience)
    : audiences === audience;
  if (!matches) return null;

  const expiry = payload['exp'];
  if (typeof expiry !== 'number' || expiry * 1000 <= Date.now()) return null;

  const issuer = payload['iss'];
  if (issuer !== `https://${team}`) return null;

  const found = (await published(team)).find((candidate) => candidate.kid === header['kid']);
  if (found === undefined) return null;

  const signed = new TextEncoder().encode(`${head}.${body}`);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    found.key,
    buffer(bytes(signature)),
    buffer(signed),
  );
  return ok ? payload : null;
}

async function published(team: string): Promise<readonly AccessKey[]> {
  keys ??= (async (): Promise<readonly AccessKey[]> => {
    const response = await fetch(`https://${team}/cdn-cgi/access/certs`);
    if (!response.ok) throw new Error(`Access certs answered ${response.status}`);
    const { keys: jwks } = (await response.json()) as { readonly keys: readonly JsonWebKey[] };
    return Promise.all(
      jwks.map(async (jwk) => ({
        kid: String((jwk as { kid?: unknown }).kid ?? ''),
        key: await crypto.subtle.importKey(
          'jwk',
          jwk,
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify'],
        ),
      })),
    );
  })().catch((error: unknown) => {
    // A failed fetch must not be cached as "this team has no keys", which would
    // lock every reviewer out until the isolate happened to be recycled.
    keys = undefined;
    throw error;
  });
  return keys;
}

function decode(part: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(bytes(part))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** `BufferSource` is `ArrayBufferView<ArrayBuffer>` here, which a plain `Uint8Array` is not. */
function buffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function bytes(part: string): Uint8Array {
  const padded = part.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
