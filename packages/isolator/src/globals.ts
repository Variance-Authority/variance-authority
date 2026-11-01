/**
 * What a session leaves on objects no transform reaches: `process.env`, and
 * the properties of `globalThis`. Each is opt-in, and each returns a function
 * that undoes it.
 */

import { perSession } from './per-session.js';
import { installOnce, realm } from './realm.js';
import { currentSession } from './session.js';

/**
 * Give every session its own `process.env`, which starts from its parent's: a
 * test reads what its file set, and what it sets itself ends with it. A file
 * starts from the environment as it was when this was called, and what a
 * module sets as it loads. Values are stored as strings, as Node stores them.
 * `TZ` is written through to the real environment and put back as the fallback
 * session switches, since Node reads the timezone from there; a `TZ` set in a
 * session a source answers with stays in that session's `process.env`.
 */
export function isolateEnv(): () => void {
  return installOnce('env', process, () => {
    const real = process.env;
    // Sessions copy from what the environment held here, not from the real one,
    // which carries the `TZ` of whichever session wrote it last.
    const base = { ...real };
    // Node holds one timezone for the process, so it follows the fallback session
    // alone: a session a source answers with, `isolated(fn)` or a concurrent
    // test's, reads its own `TZ`, and nothing announces its end to put it back.
    const syncTimezone = () => {
      if (currentSession() !== realm().fallback) return;
      const zone = env.TZ;
      if (zone === real.TZ) return;
      if (zone === undefined) delete real.TZ;
      else real.TZ = zone;
    };
    const env = perSession(base, {
      store: String,
      wrote: (key) => key === 'TZ' && syncTimezone(),
    });
    process.env = env;
    const { switched } = realm();
    switched.add(syncTimezone);
    return () => {
      switched.delete(syncTimezone);
      if (process.env !== env) return;
      process.env = real;
      if (base.TZ === undefined) delete real.TZ;
      else real.TZ = base.TZ;
    };
  });
}

/** The own properties of an object, as one session found them. */
type Snapshot = Map<PropertyKey, PropertyDescriptor>;

/**
 * Put `target`'s own properties back as each session found them when it ends:
 * what a test adds to `globalThis` is gone after it, and what it replaced is
 * back. What a rewritten module adds or replaces while it loads stays, in
 * every session, as it would on every fresh page that loads it. A property
 * that cannot be configured is left as it is.
 */
export function isolateGlobals(target: object = globalThis): () => void {
  return installOnce('globals', target, () => installGlobals(target));
}

function installGlobals(target: object): () => void {
  const state = realm();
  const found = new Map<object, Snapshot>();
  const take = (): Snapshot => new Map(Reflect.ownKeys(target).map((key) => [key, Reflect.getOwnPropertyDescriptor(target, key)!]));
  found.set(currentSession(), take());

  const switched = (ended: object | undefined) => {
    const before = ended === undefined ? undefined : found.get(ended);
    if (before !== undefined) {
      restore(target, before);
      found.delete(ended!);
    }
    const session = currentSession();
    if (!found.has(session)) found.set(session, take());
  };
  // What a load changes joins what every session found, so no ending removes it.
  let atLoad: Snapshot | undefined;
  const loads = {
    start: () => void (atLoad = take()),
    end() {
      if (atLoad === undefined) return;
      for (const [key, descriptor] of take()) {
        if (!same(atLoad.get(key), descriptor)) for (const snapshot of found.values()) snapshot.set(key, descriptor);
      }
      for (const key of atLoad.keys()) {
        if (!Reflect.getOwnPropertyDescriptor(target, key)) for (const snapshot of found.values()) snapshot.delete(key);
      }
      atLoad = undefined;
    },
  };
  state.switched.add(switched);
  state.loads.add(loads);
  return () => {
    state.switched.delete(switched);
    state.loads.delete(loads);
  };
}

function restore(target: object, before: Snapshot): void {
  for (const key of Reflect.ownKeys(target)) {
    const now = Reflect.getOwnPropertyDescriptor(target, key)!;
    const then = before.get(key);
    if (then === undefined) {
      if (now.configurable === true) Reflect.deleteProperty(target, key);
    } else if (!same(then, now)) put(target, key, now, then);
  }
  for (const [key, then] of before) if (!Reflect.getOwnPropertyDescriptor(target, key)) Reflect.defineProperty(target, key, then);
}

function put(target: object, key: PropertyKey, now: PropertyDescriptor, then: PropertyDescriptor): void {
  if (now.configurable === true) Reflect.defineProperty(target, key, then);
  else if (now.writable === true && 'value' in then) Reflect.set(target, key, then.value);
}

function same(a: PropertyDescriptor | undefined, b: PropertyDescriptor): boolean {
  return (
    a !== undefined &&
    a.value === b.value &&
    a.get === b.get &&
    a.set === b.set &&
    a.writable === b.writable &&
    a.enumerable === b.enumerable &&
    a.configurable === b.configurable
  );
}
