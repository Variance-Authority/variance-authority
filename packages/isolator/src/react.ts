/**
 * Sessions in React Server Components: one per request.
 *
 * ```ts
 * import { requestSessions } from '@variance-authority/isolator/react';
 * requestSessions();
 * ```
 *
 * React's `cache` keeps a value for the request that is rendering, so the
 * request is the session; outside a request `cache` keeps nothing, two calls
 * answer with two objects, and the fallback session answers instead.
 */

// FIXME: React's colour in a `none` package; `react` should make each request a
// session through `addSessionSource`, the extension point `isolator` exposes.
import { cache } from 'react';
import { addSessionSource } from './session.js';

const request = cache((): object => ({}));

/** Make each request a session, until the returned function is called. */
export function requestSessions(): () => void {
  return addSessionSource(() => {
    const session = request();
    return session === request() ? session : undefined;
  });
}
