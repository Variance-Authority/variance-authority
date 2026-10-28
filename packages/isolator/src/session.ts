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
 * driver runs {@link nextSession} before each test, so every test starts on
 * values its module wrote when it was first evaluated, as if nothing ran
 * before it.
 */

import { registerResetHandler } from '@variance-authority/ioc/reset';

/** Answers with the current session, or `undefined` when it has none. */
export type SessionSource = () => object | undefined;

interface Realm {
  readonly sources: SessionSource[];
  fallback: object;
}

const REALM = Symbol.for('@variance-authority/isolator');

type Host = typeof globalThis & { [REALM]?: Realm };

/**
 * The state every copy of this module shares: on `globalThis`, because a
 * reset module registry or a dual CommonJS/ES resolution hands the runtime and
 * the code that starts a session two copies of this file, and both have to
 * answer with the same session.
 */
const realm = (): Realm => ((globalThis as Host)[REALM] ??= { sources: [], fallback: {} });

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
 * starts again from its initial value. A browser calls this between runs; a
 * test suite has ioc's reset driver call it.
 */
export function nextSession(): void {
  realm().fallback = {};
}

registerResetHandler(nextSession);
