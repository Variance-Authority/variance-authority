import { Forbidden } from './worker-http.js';

/**
 * Who a request is, and whether they may do what was asked.
 *
 * Apart from the router because none of it is about routes. Who the request is
 * comes from the deployment's {@link Policy}, before anything is parsed; the
 * capability rules here run *after* a route is chosen. A person's decision is
 * written under the name the policy proved, never one a body states.
 */

/** What a request may do. `view` reads what review reads and never writes. */
export type Granted = 'ingest' | 'review' | 'share' | 'view';

/**
 * Who a request is. Only a reviewer has a name, because only a reviewer's actions
 * are attributed. `moves: false` is a run that writes itself and no baseline.
 */
export type Principal =
  | { readonly capability: 'ingest'; readonly moves?: false }
  | { readonly capability: 'share' | 'view' }
  | { readonly capability: 'review'; readonly name: string };

/**
 * Who this deployment recognizes. {@link declaredPolicy} builds one from what a
 * deployer declared, and a host with its own idea of a person writes its own, which
 * asks {@link crossSite} before it reads a credential that rides along by itself.
 */
export interface Policy {
  /** `null` is a request this deployment does not recognize. */
  principal(request: Request): Promise<Principal | null> | Principal | null;
  /** Answers routes the mechanism owns, such as a sign-in, and `null` for the rest. */
  serve?(request: Request): Promise<Response | null>;
  /** Where a person goes to become a reviewer. Absent, nothing here signs anybody in. */
  readonly signIn?: string;
}

/**
 * Whether a browser carried this write here from another origin. A person's
 * credential rides along by itself, Access's cookie to any site by default, and
 * nothing here answers CORS, so no page of ours sends one. `Sec-Fetch-Site` is the
 * browser's own reading; the `Origin` fallback is for one that does not send it. A
 * caller that sends neither is no browser, and has no credential riding along.
 */
export function crossSite(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return false;
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site !== 'same-origin' && site !== 'none';
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  return !URL.canParse(origin) || new URL(origin).host !== new URL(request.url).host;
}

/**
 * The one sentence a caller who is not recognized ever gets.
 *
 * Identical for nothing presented, a wrong credential, and a path that does not
 * exist. Any variation between those three is an oracle.
 */
export const UNAUTHENTICATED = 'a valid bearer token is required';

/** Open to anybody and carries no data: who this request is, and where to become somebody. */
export const ME_PATH = '/auth/me';

/** What {@link ME_PATH} answers. A page reads this to know whether to offer a decision or a sign-in. */
export interface Introduced {
  readonly capability?: Granted;
  readonly name?: string;
  readonly signIn?: string;
}

export function introduced(principal: Principal | null, policy: Policy): Introduced {
  return {
    ...(principal === null ? {} : { capability: principal.capability }),
    ...(principal?.capability === 'review' ? { name: principal.name } : {}),
    ...(policy.signIn === undefined ? {} : { signIn: policy.signIn }),
  };
}

/**
 * Whether two tokens are the same, compared in constant time.
 *
 * Both are hashed to a fixed 32 bytes before comparison and the comparison never
 * exits early. `===` on strings leaks the length of the common prefix through
 * timing; comparing raw strings of different lengths leaks the token's length.
 */
export async function equalTokens(presented: string, held: string): Promise<boolean> {
  const left = await fingerprint(presented);
  const right = await fingerprint(held);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function fingerprint(token: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

/**
 * The name a person's action is written under: the proved one.
 *
 * A body may repeat it, and the console does. A body naming somebody else is
 * refused rather than corrected, because the caller believes something false about
 * who is signed in and the record must not quietly disagree with them.
 */
export function attributed(principal: Principal, stated: unknown, path: string): string {
  if (principal.capability !== 'review') {
    throw new Forbidden(`${path} is written by a reviewer, and this request has no name to write`);
  }
  if (stated !== undefined && stated !== principal.name) {
    throw new Forbidden(`${path} is written as ${principal.name}, and this request says ${String(stated)}`);
  }
  return principal.name;
}

/** Why the share token was refused, whatever else the route wanted. */
const SHARE_ONLY =
  'The share token reads the lines under /share/ and what review settled — the changelog and ' +
  'the decision history — and never decides, so a machine that only reads cannot write to ' +
  'this deployment or decide on a build';

/** Why a viewer was refused, whatever the route wanted. */
const VIEW_ONLY = 'This deployment is open to view and a decision has a name on it: sign in to decide';

export function requires(granted: Granted, needed: Granted, path: string): void {
  if (granted === needed) return;
  throw new Forbidden(
    `${path} takes the ${needed} capability and this request holds ${granted}. ` +
      (granted === 'share'
        ? SHARE_ONLY
        : granted === 'view'
          ? VIEW_ONLY
          : needed === 'review'
          ? 'What people decide and write on the review surface, a baseline promoted among it, ' +
            'is not something a build log can do'
          : 'Writing to this deployment is something CI does, not something a reviewer does'),
  );
}

/**
 * Who may change what later runs compare against.
 *
 * A branch's workflow holds the same proof as the default branch's, and anybody who
 * can push a branch can write that workflow, so a baseline moved from there would
 * move it for everybody with no review. Its run is still taken.
 */
export function movesBaselines(principal: Principal, path: string): void {
  requires(principal.capability, 'ingest', path);
  if (principal.capability === 'ingest' && principal.moves === false) {
    throw new Forbidden(
      `${path} changes what later runs compare against, and this workflow ran on a ref other than ` +
        'the one GITHUB_ACTIONS_BASELINE_REF names',
    );
  }
}

/**
 * The history routes that answer a question rather than record one.
 *
 * Ingest and a reviewer may ask. The split everywhere else in the router
 * is *who is allowed to write*, and these five write nothing: churn, reach,
 * flakiness, the value journey and the last change are derived from rows already
 * recorded. A reviewer looking at a build needs exactly these to know whether the
 * difference in front of them is the third this week or the first this year, and
 * refusing them would mean a review surface that can approve a change it cannot
 * put in context.
 *
 * It stays a rule with a name rather than an omitted check, because the next
 * history route added is a write far more often than it is a read, and the
 * default has to be the strict one.
 */
export function readable(granted: Granted, path: string): void {
  if (granted !== 'ingest') seen(granted, path);
}

/**
 * What a reviewer reads, which is what a viewer reads: an opened deployment shows
 * the evidence and only the deciding is closed.
 */
export function seen(granted: Granted, path: string): void {
  if (granted !== 'view') requires(granted, 'review', path);
}

/**
 * Who may read what review settled: everybody but ingest.
 *
 * The record of decisions is what an agent or a developer's machine asks after
 * the fact — was this subject approved, by whom, and why — and those readers
 * hold the share token, which cannot decide. A reviewer reads it because they
 * wrote it, a viewer because the deployment opened it. Ingest is refused: CI holds
 * it, and a build log is not a reader of reviews, so the credential most likely to
 * leak gains nothing here.
 *
 * Only reads pass through this rule. A route that writes a decision or a concern
 * keeps {@link requires} with `review`, so the share token still never decides.
 */
export function attested(granted: Granted, path: string): void {
  if (granted === 'review' || granted === 'share' || granted === 'view') return;
  throw new Forbidden(
    `${path} is read by a reviewer or with the share token, and this request presented an ingest ` +
      'credential. CI holds that, and what reviewers decided is not for a build log to read',
  );
}

/**
 * Who may open a share: ingest reads and writes it, the share token only reads
 * it, and a person does neither.
 *
 * A person is refused because a share is the record runs read and write, and a
 * reviewer's browser has no use for it. Letting them read would make the share
 * token pointless for the one case it is for — a reader that must not be able to
 * decide on a build.
 */
export function sharable(granted: Granted, writes: boolean, path: string): void {
  if (granted === 'ingest') return;
  if (granted === 'share' && !writes) return;
  throw new Forbidden(
    granted === 'share'
      ? `${path} is written with the ingest token, and the share token only reads. Publishing ` +
          'a line is something CI does'
      : `${path} is a share, served to the ingest token and the share token, and this request ` +
          'presented neither. A person reads the review surface',
  );
}
