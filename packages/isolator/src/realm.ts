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
  /** How many rewritten modules are running their top level now. */
  loading: number;
  /** Told after the fallback session changes, with the session that ended, if one did. */
  switched: Set<(ended: object | undefined) => void>;
  /** Told as the first rewritten module starts its top level and as the last one ends. */
  loads: Set<Loads>;
}

/** Hears when rewritten modules start and stop running their top levels. */
export interface Loads {
  start(): void;
  end(): void;
}

const REALM = Symbol.for('@variance-authority/isolator');

/** What an older copy of this module made: only `sources` and `fallback` are sure. */
type Optional = 'file' | 'parents' | 'loading' | 'switched' | 'loads';
type Stored = Omit<Realm, Optional> & Partial<Pick<Realm, Optional>>;

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
  state.loading ??= 0;
  state.switched ??= new Set();
  state.loads ??= new Set();
  return state as Realm;
};

/** A new test session: it starts from what its file wrote outside tests. */
export function testSession(): object {
  const state = realm();
  const session = {};
  state.parents.set(session, state.file);
  return session;
}

/** The session `session` starts from, when it is a test's; `undefined` when it starts from the load. */
export function parentSession(session: object): object | undefined {
  return realm().parents.get(session);
}

/** Make `session` the fallback and tell who listens which session ended. */
export function switchTo(session: object, ended: object | undefined): void {
  const state = realm();
  state.fallback = session;
  // Every listener cleans up after the ended session, even when one before it throws.
  const failures: unknown[] = [];
  for (const listener of state.switched) {
    try {
      listener(ended);
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'the ended session left more than one leak');
}

/** Count one more top level running; the first tells who listens. */
export function startLoad(): void {
  const state = realm();
  if (state.loading++ !== 0) return;
  for (const listener of state.loads) listener.start();
  // A top level runs to its end in one turn, since a module that awaits is never
  // rewritten: one that threw before `endLoad()` stops counting at the next.
  queueMicrotask(() => {
    if (state.loading !== 0) {
      state.loading = 0;
      for (const listener of state.loads) listener.end();
    }
  });
}

/** Count one top level finished; the last tells who listens. */
export function endLoad(): void {
  const state = realm();
  if (state.loading === 0) return;
  if (--state.loading === 0) for (const listener of state.loads) listener.end();
}
