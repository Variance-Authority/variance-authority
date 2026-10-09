import type { ReviewStore } from './review-types.js';
import { requires, type Granted } from './worker-auth.js';
import { count, json, optional, requireMethod, required } from './worker-http.js';

/**
 * The review routes that read what was decided, apart from the ones that decide.
 *
 * A build, its images and the decision on it are the review surface, and the
 * review token holds them. What reviewers *settled* — the changelog of approved
 * baselines — is the record a reader asks about after the fact, and it is
 * served from here so the rule that admits a caller to it is written once.
 */

/** The changelog of approved baselines, grouped by the change each one settled. */
export const CHANGELOG_PATH = '/review/changelog';

/** Answers one request on a path this file owns, for the capability the router granted. */
export type AttestedRoute = (granted: Granted, url: URL, request: Request) => Promise<Response>;

export function createAttestedRoutes(review: ReviewStore): AttestedRoute {
  return async (granted, url, request) => {
    const path = url.pathname;
    requires(granted, 'review', path);
    requireMethod(request, 'GET');
    const limit = optional(url, 'limit');
    return json(
      200,
      await review.changelog({
        ...(optional(url, 'component') !== undefined
          ? { component: required(url, 'component') }
          : {}),
        ...(optional(url, 'subject') !== undefined ? { subject: required(url, 'subject') } : {}),
        ...(optional(url, 'since') !== undefined ? { since: required(url, 'since') } : {}),
        ...(limit !== undefined ? { limit: count(limit) } : {}),
      }),
    );
  };
}
