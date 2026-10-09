import { DECISIONS_LIMIT } from './review-summary.js';
import type { ReviewStore } from './review-types.js';
import { attested, type Granted } from './worker-auth.js';
import { BadRequest, count, json, optional, requireMethod, required } from './worker-http.js';

/**
 * The review routes that read what was decided, apart from the ones that decide.
 *
 * A build, its images and the act of deciding are the review surface, and the
 * review token holds them. What reviewers *settled* — the changelog of approved
 * baselines and the history of every decision — is the record a reader asks
 * about after the fact, and an agent or a developer's machine holding the share
 * token is such a reader. Every route here is a `GET`, every one is admitted by
 * {@link attested}, and a route that writes never belongs in this file: the
 * share token reads, and never decides.
 *
 * A route that both reads and writes on one path — concerns, listed with `GET`
 * and raised with `POST` — does not move here, because every path here refuses
 * any method but `GET`. Its own `GET` branch calls {@link attested} instead of
 * `requires(granted, 'review')`, and its write keeps the review token.
 */

/** The changelog of approved baselines, grouped by the change each one settled. */
export const CHANGELOG_PATH = '/review/changelog';

/**
 * Every decision recorded on a build, a subject or both, newest first; `?limit=`
 * takes fewer than {@link DECISIONS_LIMIT}. A reading that names neither is
 * refused rather than answered with the project's newest decisions, which would
 * be a sample under a heading that reads as an answer.
 */
export const DECISIONS_PATH = '/review/decisions';

/** The paths this file answers, so the router asks one question rather than one per path. */
export const ATTESTED_PATHS: ReadonlySet<string> = new Set([CHANGELOG_PATH, DECISIONS_PATH]);

/** Answers one request on a path this file owns, for the capability the router granted. */
export type AttestedRoute = (granted: Granted, url: URL, request: Request) => Promise<Response>;

export function createAttestedRoutes(review: ReviewStore): AttestedRoute {
  return async (granted, url, request) => {
    const path = url.pathname;
    attested(granted, path);
    requireMethod(request, 'GET');
    const limit = optional(url, 'limit');
    const narrowed = {
      ...(optional(url, 'subject') !== undefined ? { subject: required(url, 'subject') } : {}),
      ...(limit !== undefined ? { limit: count(limit) } : {}),
    };

    if (path === DECISIONS_PATH) {
      const build = optional(url, 'build') !== undefined ? required(url, 'build') : undefined;
      if (build === undefined && narrowed.subject === undefined) {
        throw new BadRequest(
          `a reading of ${DECISIONS_PATH} names a \`build\`, a \`subject\` or both: the decisions on what?`,
        );
      }
      if (narrowed.limit !== undefined && narrowed.limit > DECISIONS_LIMIT) {
        throw new BadRequest(
          `${DECISIONS_PATH} reads at most ${DECISIONS_LIMIT} decisions at once; received limit=${narrowed.limit}. Narrow it by \`build\` and \`subject\` instead`,
        );
      }
      return json(200, {
        decisions: await review.decisions({ ...narrowed, ...(build !== undefined ? { build } : {}) }),
      });
    }

    return json(
      200,
      await review.changelog({
        ...narrowed,
        ...(optional(url, 'component') !== undefined
          ? { component: required(url, 'component') }
          : {}),
        ...(optional(url, 'since') !== undefined ? { since: required(url, 'since') } : {}),
      }),
    );
  };
}
