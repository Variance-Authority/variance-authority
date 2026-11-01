/**
 * The isolator's state on `globalThis`, shared by the session entry and the
 * runtime. Not a package entry: only this package reads it.
 */

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
export const realm = (): Realm => {
  const state = ((globalThis as Host)[REALM] ??= { sources: [], fallback: {} });
  state.file ??= state.fallback;
  state.parents ??= new WeakMap();
  return state as Realm;
};

/** The session `session` starts from, when it is a test's; `undefined` when it starts from the load. */
export function parentSession(session: object): object | undefined {
  return realm().parents.get(session);
}
