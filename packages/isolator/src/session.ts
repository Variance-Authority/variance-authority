/**
 * Whose state a frame reads: the session.
 *
 * A session is any object. Each frame keeps one set of values per session, so two
 * sessions never see each other's writes, and a session nobody holds any more
 * takes its values with it. Who decides the current session is a *source*: the
 * Node entry asks `AsyncLocalStorage`, the React entry asks `cache`. The first
 * source that answers wins; when none does, the session is the fallback key,
 * and {@link nextSession} replaces it.
 *
 * Between tests nothing has to be called: `@variance-authority/ioc/reset`'s
 * driver enters this module's test scope. A file starts on the values its
 * modules were loaded with; what its collection and its once-per-scope hooks
 * (`beforeAll`, `afterAll`) write is kept in the file's session, and each test
 * runs in a session of its own that starts from it and is dropped when the
 * test ends — as if the file ran alone, in a fresh worker.
 */

import { registerTestScope } from '@variance-authority/ioc/reset';
import { realm, type SessionSource } from './realm.js';

export type { SessionSource } from './realm.js';

/**
 * Add a source of sessions, asked before every source added after it.
 *
 * @returns a function that removes it.
 */
export function addSessionSource(source: SessionSource): () => void {
  const { sources } = realm();
  sources.push(source);
  return () => {
    const at = sources.indexOf(source);
    if (at !== -1) sources.splice(at, 1);
  };
}

/** The session a frame reads now. */
export function currentSession(): object {
  const state = realm();
  for (const source of state.sources) {
    const session = source();
    if (session !== undefined) return session;
  }
  return state.fallback;
}

/**
 * Start a new fallback session: every frame read outside any source's session
 * starts again from the values its module was loaded with. A browser calls
 * this between runs; a test suite has ioc's driver call it as each file starts.
 */
export function nextSession(): void {
  const state = realm();
  state.fallback = state.file = {};
}

registerTestScope({
  enterFile: nextSession,
  enterTest() {
    const state = realm();
    const test = {};
    state.parents.set(test, state.file);
    state.fallback = test;
  },
  leaveTest() {
    const state = realm();
    state.fallback = state.file;
  },
});
