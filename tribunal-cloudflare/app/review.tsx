'use client';

import { ReviewApp, createReviewClient } from '@variance-authority/tribunal/ui';

/**
 * The review surface, in the browser, holding no credential.
 *
 * `createReviewClient` is given an endpoint and no token: the route handler this
 * page calls holds the review token and attaches it on behalf of a caller Access
 * has already identified. Nothing secret is serialized into the page, which is
 * the same arrangement the Next.js adapter documents and the Node service uses.
 */
export function Review({ reviewer }: { readonly reviewer: string }): React.ReactElement {
  return <ReviewApp client={createReviewClient({ endpoint: '/api' })} reviewer={reviewer} />;
}
