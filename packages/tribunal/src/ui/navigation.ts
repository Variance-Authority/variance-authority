/**
 * The address bar, as a hook — thirty lines of history API and no router.
 *
 * The surface has one navigation and it is a path. A router library would bring
 * a context, a matcher, a link component and a peer dependency to do that, into a
 * package whose entire claim is that it needs React and nothing else. The
 * platform already has `pushState` and `popstate`.
 *
 * ## Controlled, when the host has its own history
 *
 * A Next app renders {@link ReviewApp} inside a router that already owns the URL,
 * and two things writing to one history stack is a back button that goes
 * sideways. So the hook takes the host's route and its navigate function when it
 * is given them, and touches nothing. The uncontrolled path — the Node service,
 * which serves a document and one script — is the one that reads `location`.
 */

import { useCallback, useEffect, useState } from 'react';
import { hrefOf, parseRoute, type Route } from './route.js';

/** The address as it stands, or `undefined` when this surface does not answer it. */
function readLocation(): Route | undefined {
  if (typeof window === 'undefined') return { page: 'builds' };
  return parseRoute(`${window.location.pathname}${window.location.search}`);
}

/**
 * Where the reader is, and how to send them somewhere else.
 *
 * `undefined` is a real answer and is not turned into the front page. A path
 * nobody claims is a rotted link, and quietly rendering the build list tells the
 * reader their link worked.
 */
export function useRoute(
  route?: Route | undefined,
  onNavigate?: ((route: Route) => void) | undefined,
): readonly [Route | undefined, (route: Route) => void] {
  const controlled = route !== undefined && onNavigate !== undefined;
  const [here, setHere] = useState<Route | undefined>(readLocation);

  useEffect(() => {
    if (controlled || typeof window === 'undefined') return undefined;

    const listen = (): void => setHere(readLocation());
    window.addEventListener('popstate', listen);
    return () => window.removeEventListener('popstate', listen);
  }, [controlled]);

  const go = useCallback((next: Route): void => {
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', hrefOf(next));
      // A page that keeps the previous page's scroll position is a page that
      // opens two thirds of the way down a list the reader has not seen.
      window.scrollTo({ top: 0 });
    }
    setHere(next);
  }, []);

  return controlled ? [route, onNavigate] : [here, go];
}
