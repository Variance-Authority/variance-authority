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
 * `dist/public/ui/review.js`, for the reason recorded in
 * [`node/ui-assets.ts`](../node/ui-assets.ts).
 *
 * It reads its configuration from the document rather than taking it baked in,
 * because the bundle is built once and every deployment mounts the API somewhere
 * else. It holds **no token**: who is looking is what `/auth/me` says, from a
 * session the browser sends by itself, and a person nobody recognized goes to
 * sign in before anything is drawn.
 */

const mount = document.getElementById('variance-review');
const configuration = document.getElementById('variance-config');

if (mount === null) {
  throw new Error('the review page has no #variance-review element to mount into');
}
if (configuration === null) {
  throw new Error('the review page has no #variance-config script to read its endpoint from');
}

const { endpoint = '' } = JSON.parse(configuration.textContent ?? '{}') as { readonly endpoint?: string };

interface Introduced {
  readonly capability?: string;
  readonly name?: string;
  readonly signIn?: string;
}

const me = (await (await fetch(`${endpoint}/auth/me`)).json()) as Introduced;
const signIn =
  me.signIn === undefined
    ? undefined
    : `${endpoint}${me.signIn}?return=${encodeURIComponent(location.pathname + location.search)}`;

if (me.capability === undefined && signIn !== undefined) {
  location.assign(signIn);
} else if (me.capability === undefined) {
  mount.textContent = 'This deployment does not recognize you.';
} else {
  createRoot(mount).render(
    <StrictMode>
      {me.capability === 'view' && signIn !== undefined ? <a href={signIn}>Sign in to decide</a> : null}
      <ReviewApp client={createReviewClient({ endpoint })} reviewer={me.name} />
    </StrictMode>,
  );
}
