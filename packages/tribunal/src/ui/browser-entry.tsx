import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createReviewClient } from './client.js';
import { ReviewApp } from './review.js';

/**
 * The half that runs in a browser, for hosts that do not have a framework.
 *
 * A Next.js app renders {@link ReviewApp} itself and never loads this — it has a
 * bundler, a router and a hydration story of its own, and handing it a
 * pre-bundled React would give the page two of them. This file exists for the
 * Node service, which has none of that: it serves a document and needs one script
 * that turns it into the surface.
 *
 * Bundled at this repository's build time by `tools/tribunal-ui.mjs` into
 * `dist/ui/review.bundle.js`, for the reason recorded in
 * [`node/ui-assets.ts`](../node/ui-assets.ts).
 *
 * It reads its configuration from the document rather than taking it baked in,
 * because the bundle is built once and every deployment mounts the API somewhere
 * else. It reads **no token**: the host attaches the capability, and this script
 * calls its own origin with no credential.
 */

const mount = document.getElementById('variance-review');
const configuration = document.getElementById('variance-config');

if (mount === null) {
  throw new Error('the review page has no #variance-review element to mount into');
}
if (configuration === null) {
  throw new Error('the review page has no #variance-config script to read its endpoint from');
}

const { endpoint, reviewer } = JSON.parse(configuration.textContent ?? '{}') as {
  readonly endpoint?: string;
  readonly reviewer?: string;
};

createRoot(mount).render(
  <StrictMode>
    <ReviewApp
      client={createReviewClient({ endpoint: endpoint ?? '' })}
      reviewer={reviewer ?? 'reviewer'}
    />
  </StrictMode>,
);
