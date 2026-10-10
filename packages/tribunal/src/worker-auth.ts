import { Forbidden } from './worker-http.js';

/**
 * Which secret a request presented, whether the deployment's secrets are distinct
 * at all, and whether the one presented may do what was asked.
 *
 * Apart from the router because none of it is about routes. Read together it is
 * the whole authentication story — the check that runs before anything is parsed,
 * the comparison that must not leak, the length below which a shared secret is a
 * public one, and the capability rule that runs *after* a route is chosen. The
 * argument for why there are separate tokens rather than one lives in
 * [`worker.ts`](./worker.ts), where an operator configuring a deployment meets it
 * first.
 */

/** Which secret a request presented, or nothing at all. */
export type Granted = 'ingest' | 'review' | 'share';

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
 * The secrets, and nothing else this file has any business reading.
 *
 * Structural rather than `TribunalOptions` on purpose: authentication cannot be
 * made to depend on a project name or a retention window by a later edit, because
 * it cannot see them.
 */
interface Secrets {
  readonly ingestToken: string;
  readonly reviewToken: string;
  /** Optional: a deployment that shares nothing, or shares only with CI, has no reader to give one to. */
  readonly shareToken?: string | undefined;
}

/**
 * Which token was presented, compared in constant time.
 *
 * Both are hashed to a fixed 32 bytes before comparison and the comparison never
 * exits early. `===` on strings leaks the length of the common prefix through
 * timing; comparing raw strings of different lengths leaks the token's length. A
 * digest makes every comparison the same shape whatever arrives.
 *
 * Every candidate is always checked, even after one matches, so that "which
 * token is this" costs the same whichever it is.
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
  const isShare =
    secrets.shareToken !== undefined && equal(digest, await fingerprint(secrets.shareToken));

  return isIngest ? 'ingest' : isReview ? 'review' : isShare ? 'share' : null;
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
  const named: (readonly [string, string])[] = [
    ['ingestToken', secrets.ingestToken],
    ['reviewToken', secrets.reviewToken],
  ];
  // Set is set: an empty `shareToken` is a secret nobody has to guess, so it is
  // refused like a short one rather than read as "no share token".
  if (secrets.shareToken !== undefined) named.push(['shareToken', secrets.shareToken]);

  for (const [name, token] of named) {
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

  if (secrets.shareToken === secrets.ingestToken || secrets.shareToken === secrets.reviewToken) {
    throw new Error(
      `the share token is the same value as the ${
        secrets.shareToken === secrets.ingestToken ? 'ingest' : 'review'
      } token. The share token exists to be handed to machines that only read a share, and ` +
        'handing one out would then hand out everything the other token can do',
    );
  }
}

/** Why the share token was refused, whatever else the route wanted. */
const SHARE_ONLY =
  'The share token reads the lines under /share/ and nothing else, so a machine that only ' +
  'reads a shared record cannot write to this deployment or decide on a build';

export function requires(granted: Granted, needed: Granted, path: string): void {
  if (granted === needed) return;
  throw new Forbidden(
    `${path} is served to the ${needed} token and this request presented the ${granted} one. ` +
      (granted === 'share'
        ? SHARE_ONLY
        : needed === 'review'
          ? 'What people decide and write on the review surface, a baseline promoted among it, ' +
            'is not something a build log can do'
          : 'Writing to this deployment is something CI does, not something a reviewer does'),
  );
}

/**
 * The history routes that answer a question rather than record one.
 *
 * The ingest and review tokens may ask. The split everywhere else in the router
 * is *who is allowed to write*, and these five write nothing: churn, reach,
 * flakiness, the value journey and the last change are derived from rows already
 * recorded. A reviewer looking at a build needs exactly these to know whether the
 * difference in front of them is the third this week or the first this year, and
 * the browser that draws that page holds the review token — so refusing them
 * would mean a review surface that can approve a change it cannot put in context.
 *
 * It stays a rule with a name rather than an omitted check, because the next
 * history route added is a write far more often than it is a read, and the
 * default has to be the strict one.
 */
export function readable(granted: Granted, path: string): void {
  if (granted !== 'ingest') requires(granted, 'review', path);
}

/**
 * Who may open a share: the ingest token reads and writes it, the share token
 * only reads it, and the review token does neither.
 *
 * The review token is refused because it is held by people and by the browser
 * that draws the review surface, and a share is the record runs read and write.
 * Letting it read would make the share token pointless for the one case it is
 * for — a reader that must not be able to decide on a build.
 */
export function sharable(granted: Granted, writes: boolean, path: string): void {
  if (granted === 'ingest') return;
  if (granted === 'share' && !writes) return;
  throw new Forbidden(
    granted === 'share'
      ? `${path} is written with the ingest token, and the share token only reads. Publishing ` +
          'a line is something CI does'
      : `${path} is a share, served to the ingest token and the share token, and this request ` +
          'presented the review token. The review token is for people deciding on builds',
  );
}
