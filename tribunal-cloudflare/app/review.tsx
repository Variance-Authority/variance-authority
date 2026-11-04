'use client';

import { ReviewApp, createReviewClient } from '@variance-authority/tribunal/ui';

/**
 * The review surface, in the browser, holding no credential.
 *
 * `createReviewClient` is given an endpoint and no token: every call carries the
 * browser's session and the route judges it. No `reviewer` is a reader, and the
 * surface offers them nothing to decide with.
 */
export function Review({ reviewer }: { readonly reviewer: string | undefined }): React.ReactElement {
  return <ReviewApp client={createReviewClient({ endpoint: '/api' })} reviewer={reviewer} />;
}
