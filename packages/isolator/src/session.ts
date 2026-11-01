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

/** Answers with the current session, or `undefined` when it has none. */
export type SessionSource = () => object | undefined;

interface Realm {
  readonly sources: SessionSource[];
  fallback: object;
  /** The file's session: what collection and once-per-scope hooks wrote. */
  file: object;
  /** The session each test session starts from. */
  parents: WeakMap<object, object>;
}

const REALM = Symbol.for('@variance-authority/isolator');

/** A realm an older copy of this module made has neither `file` nor `parents`. */
type Stored = Omit<Realm, 'file' | 'parents'> & Partial<Pick<Realm, 'file' | 'parents'>>;

type Host = typeof globalThis & { [REALM]?: Stored };

/**
 * The state every copy of this module shares: on `globalThis`, because a
 * reset module registry or a dual CommonJS/ES resolution hands the runtime and
 * the code that starts a session two copies of this file, and both have to
 * answer with the same session.
 */
const realm = (): Realm => {
  const state = ((globalThis as Host)[REALM] ??= { sources: [], fallback: {} });
  state.file ??= state.fallback;
  state.parents ??= new WeakMap();
  return state as Realm;
};

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

/** The session `session` starts from, when it is a test's; `undefined` when it starts from the load. */
export function parentSession(session: object): object | undefined {
  return realm().parents.get(session);
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
