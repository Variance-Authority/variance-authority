/**
 * The isolator's state on `globalThis`, shared by the session entry and the
 * runtime. Not a package entry: only this package reads it.
 */

/** Answers with the current session, or `undefined` when it has none. */
export type SessionSource = () => object | undefined;

interface Realm {
  readonly sources: SessionSource[];
  fallback: object;
  /** The fallback session before any was started: setup, whose writes every session starts from. */
  base: object;
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
  /** What each `isolate…` function installed, by what it isolates and by function: a second call installs nothing. */
  installed: WeakMap<object, Map<string, () => void>>;
}

/** Hears when rewritten modules start and stop running their top levels. */
export interface Loads {
  start(): void;
  end(): void;
}

const REALM = Symbol.for('@variance-authority/isolator');

/** What an older copy of this module made: only `sources` and `fallback` are sure. */
type Optional = 'base' | 'file' | 'parents' | 'loading' | 'switched' | 'loads' | 'installed';
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
  state.base ??= state.fallback;
  state.file ??= state.fallback;
  state.parents ??= new WeakMap();
  state.loading ??= 0;
  state.switched ??= new Set();
  state.loads ??= new Set();
  state.installed ??= new WeakMap();
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

/**
 * Whether what runs now lands in every session, as a fresh page would hold it:
 * a rewritten module's top level, or setup — anything that runs before the
 * first session starts, outside any source's session.
 */
export function inEverySession(current: object): boolean {
  const state = realm();
  return state.loading > 0 || current === state.base;
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

/**
 * Install the `kind` of isolation for `subject` once per realm: a setup file that runs again
 * for every file in one worker gets the installation already there.
 *
 * @returns what undoes the installation, or nothing for a call that installed nothing.
 */
export function installOnce(kind: string, subject: object, install: () => () => void): () => void {
  const { installed } = realm();
  let kinds = installed.get(subject);
  if (kinds === undefined) installed.set(subject, (kinds = new Map()));
  if (kinds.has(kind)) return () => {};
  // What an isolation puts in place is there on every fresh page, as what a
  // module does as it loads is: no session's end takes it away.
  const undo = asLoad(install);
  kinds.set(kind, undo);
  return () => {
    if (kinds.get(kind) !== undo) return;
    kinds.delete(kind);
    asLoad(undo);
  };
}

function asLoad<T>(body: () => T): T {
  startLoad();
  try {
    return body();
  } finally {
    endLoad();
  }
}
