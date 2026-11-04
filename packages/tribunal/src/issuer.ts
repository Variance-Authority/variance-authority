/**
 * One check for every credential an issuer signs.
 *
 * Cloudflare Access and GitHub Actions are the same question: an issuer, the keys
 * it publishes, an audience and a lifetime. Each declared mechanism is an instance
 * of this, and reads its own claim from what comes back.
 *
 * A refusal is an answer, with the claim and the value it saw, for the
 * deployment's log and never for the caller. An issuer that cannot be reached is
 * not a refusal: it throws, and a broken key fetch is reported as a failure rather
 * than as a caller who presented nothing.
 */

/** Seconds of clock difference forgiven on `exp` and `nbf`. */
const SKEW = 30;

/** How soon an unknown `kid` may fetch the keys again, so it cannot be made to fetch per request. */
const REFETCH_INTERVAL_MS = 60_000;

export type Verified =
  | { readonly claims: Readonly<Record<string, unknown>> }
  | { readonly refused: string };

export interface IssuerOptions {
  /** The exact `iss` a token must carry. */
  readonly issuer: string;
  /** Where the keys are. Absent, the issuer's OpenID discovery document says. */
  readonly keysUrl?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export interface Issuer {
  verify(token: string, audience: string): Promise<Verified>;
}

interface PublishedKey {
  readonly kid: string;
  readonly key: CryptoKey;
}

export function createIssuer(options: IssuerOptions): Issuer {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;

  let keys: Promise<readonly PublishedKey[]> | undefined;
  let fetchedAt = -Infinity;

  async function fetchKeys(): Promise<readonly PublishedKey[]> {
    const url = options.keysUrl ?? (await discovered());
    const response = await send(url);
    if (!response.ok) throw new Error(`the keys at ${url} answered ${response.status}`);
    const { keys: published } = (await response.json()) as { readonly keys: readonly JsonWebKey[] };
    return Promise.all(
      published.map(async (jwk) => ({
        kid: String((jwk as { kid?: unknown }).kid ?? ''),
        key: await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
          'verify',
        ]),
      })),
    );
  }

  async function discovered(): Promise<string> {
    const url = `${options.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const response = await send(url);
    if (!response.ok) throw new Error(`the discovery document at ${url} answered ${response.status}`);
    const { jwks_uri: found } = (await response.json()) as { readonly jwks_uri?: unknown };
    if (typeof found !== 'string') throw new Error(`the discovery document at ${url} names no jwks_uri`);
    return found;
  }

  function published(): Promise<readonly PublishedKey[]> {
    fetchedAt = now();
    keys = fetchKeys().catch((error: unknown) => {
      // A failed fetch must not be remembered as an issuer with no keys, which
      // would lock everybody out until the isolate happened to be recycled.
      keys = undefined;
      fetchedAt = -Infinity;
      throw error;
    });
    return keys;
  }

  async function keyFor(kid: unknown): Promise<CryptoKey | undefined> {
    const known = await (keys ?? published());
    const found = known.find((candidate) => candidate.kid === kid);
    if (found !== undefined || now() - fetchedAt < REFETCH_INTERVAL_MS) return found?.key;
    return (await published()).find((candidate) => candidate.kid === kid)?.key;
  }

  return {
    async verify(token, audience) {
      const [head, body, signature] = token.split('.');
      if (head === undefined || body === undefined || signature === undefined) {
        return { refused: 'the token has not three parts' };
      }
      const header = decoded(head);
      const claims = decoded(body);
      if (header === null || claims === null) return { refused: 'the token is not JSON' };
      if (header['alg'] !== 'RS256') return { refused: `alg is ${String(header['alg'])}, and only RS256 is read` };

      if (claims['iss'] !== options.issuer) {
        return { refused: `iss is ${String(claims['iss'])}, and ${options.issuer} is declared` };
      }
      const audiences = claims['aud'];
      if (!(Array.isArray(audiences) ? audiences.includes(audience) : audiences === audience)) {
        return { refused: `aud is ${String(audiences)}, and ${audience} is declared` };
      }

      const seconds = now() / 1000;
      const expiry = claims['exp'];
      if (typeof expiry !== 'number' || expiry + SKEW <= seconds) return { refused: `exp is ${String(expiry)}` };
      const notBefore = claims['nbf'];
      if (typeof notBefore === 'number' && notBefore - SKEW > seconds) return { refused: `nbf is ${notBefore}` };

      const key = await keyFor(header['kid']);
      if (key === undefined) return { refused: `the issuer publishes no key ${String(header['kid'])}` };

      const presented = bytes(signature);
      if (presented === null) return { refused: 'the signature is not base64url' };
      const signed = new TextEncoder().encode(`${head}.${body}`);
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, buffer(presented), buffer(signed));
      return ok ? { claims } : { refused: 'the signature does not verify' };
    },
  };
}

function decoded(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes(part) ?? new Uint8Array()));
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `BufferSource` is `ArrayBufferView<ArrayBuffer>` here, which a plain `Uint8Array` is not. */
function buffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

/** Base64url, or `null` for what a stranger sent that is not. */
export function bytes(part: string): Uint8Array | null {
  const padded = part.replaceAll('-', '+').replaceAll('_', '/');
  try {
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The `iss` of a token, unverified: it picks which keys are checked and grants nothing. */
export function unverifiedIssuer(token: string): string | null {
  const body = token.split('.')[1];
  if (body === undefined) return null;
  const issuer = decoded(body)?.['iss'];
  return typeof issuer === 'string' ? issuer : null;
}
