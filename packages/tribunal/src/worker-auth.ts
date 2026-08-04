import { Forbidden } from './worker-http.js';

/**
 * Which of the two secrets a request presented, whether the deployment has two of
 * them at all, and whether the one presented may do what was asked.
 *
 * Apart from the router because none of it is about routes. Read together it is
 * the whole authentication story — the check that runs before anything is parsed,
 * the comparison that must not leak, the length below which a shared secret is a
 * public one, and the capability rule that runs *after* a route is chosen. The
 * argument for why there are two tokens rather than one lives in
 * [`worker.ts`](./worker.ts), where an operator configuring a deployment meets it
 * first.
 */

/** Which of the two secrets a request presented, or nothing at all. */
export type Granted = 'ingest' | 'review';

/** The shortest token this will start with. A short shared secret is a public one. */
const MIN_TOKEN = 16;

/**
 * The one sentence a caller holding neither token ever gets.
 *
 * Identical for a missing token, a wrong token, and a path that does not exist.
 * Any variation between those three is an oracle.
 */
export const UNAUTHENTICATED = 'a valid bearer token is required';

/**
 * The two secrets, and nothing else this file has any business reading.
 *
 * Structural rather than `TribunalOptions` on purpose: authentication cannot be
 * made to depend on a project name or a retention window by a later edit, because
 * it cannot see them.
 */
interface Secrets {
  readonly ingestToken: string;
  readonly reviewToken: string;
}

/**
 * Which token was presented, compared in constant time.
 *
 * Both are hashed to a fixed 32 bytes before comparison and the comparison never
 * exits early. `===` on strings leaks the length of the common prefix through
 * timing; comparing raw strings of different lengths leaks the token's length. A
 * digest makes every comparison the same shape whatever arrives.
 *
 * Both candidates are always checked, even after the first one matches, so that
 * "which token is this" costs the same either way.
 */
export async function grant(request: Request, secrets: Secrets): Promise<Granted | null> {
  const header = request.headers.get('authorization');
  if (header === null) return null;

  const match = /^Bearer (.+)$/i.exec(header.trim());
  const presented = match?.[1];
  if (presented === undefined) return null;

  const digest = await fingerprint(presented);
  const isIngest = equal(digest, await fingerprint(secrets.ingestToken));
  const isReview = equal(digest, await fingerprint(secrets.reviewToken));

  return isIngest ? 'ingest' : isReview ? 'review' : null;
}

async function fingerprint(token: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export function refuseWeakTokens(secrets: Secrets): void {
  for (const [name, token] of [
    ['ingestToken', secrets.ingestToken],
    ['reviewToken', secrets.reviewToken],
  ] as const) {
    if (token.trim().length < MIN_TOKEN) {
      throw new Error(
        `\`${name}\` is shorter than ${MIN_TOKEN} characters. This deployment holds every ` +
          'baseline and every observation a project has produced, and it can promote one; a ' +
          'guessable shared secret in front of that is not a configuration mistake anybody ' +
          'notices until it matters',
      );
    }
  }

  if (secrets.ingestToken === secrets.reviewToken) {
    throw new Error(
      'the ingest token and the review token are the same value, so this deployment has one ' +
        'secret and not two. The separation is the whole point: the ingest token lives in CI ' +
        'configuration, and approving promotes a baseline — anything that can read a build log ' +
        'would be able to approve a regression',
    );
  }
}

export function requires(granted: Granted, needed: Granted, path: string): void {
  if (granted === needed) return;
  throw new Forbidden(
    `${path} is served to the ${needed} token and this request presented the ${granted} one. ` +
      (needed === 'review'
        ? 'Deciding promotes a baseline, so it is not something a build log can do'
        : 'Writing to this deployment is something CI does, not something a reviewer does'),
  );
}
