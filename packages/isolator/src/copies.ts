/**
 * One copy of some state per session, made on first touch: a test's session
 * copies its file's, which copies the base. The frame of a module and a
 * per-session object both keep their copies here.
 */

import { parentSession } from './realm.js';

/** The copies of one piece of state, by session. */
export interface Copies<C extends object> {
  /** The session's copy, made from its parent's, or from the base, when it has none yet. */
  of(session: object): C;
  /** The nearest copy the session or a session it starts from already holds. */
  nearest(session: object): C | undefined;
  /** Every copy a session still holds, for a write that lands in all of them. */
  live(): C[];
}

/** `make(from)` copies `from` for a new session. */
export function copies<C extends object>(base: C, make: (from: C) => C): Copies<C> {
  const bySession = new WeakMap<object, C>();
  const live = new Set<WeakRef<C>>();
  let sweepAt = 64;
  const sweep = () => {
    for (const ref of live) if (ref.deref() === undefined) live.delete(ref);
  };
  const of = (session: object): C => {
    let copy = bySession.get(session);
    if (copy === undefined) {
      const parent = parentSession(session);
      bySession.set(session, (copy = make(parent === undefined ? base : of(parent))));
      live.add(new WeakRef(copy));
      // A session that ended leaves its reference behind: drop them as they pile up.
      if (live.size > sweepAt) {
        sweep();
        sweepAt = Math.max(64, live.size * 2);
      }
    }
    return copy;
  };
  const nearest = (session: object): C | undefined => {
    const copy = bySession.get(session);
    if (copy !== undefined) return copy;
    const parent = parentSession(session);
    return parent === undefined ? undefined : nearest(parent);
  };
  return {
    of,
    nearest,
    live() {
      sweep();
      return [...live].map((ref) => ref.deref()!);
    },
  };
}

/**
 * `value` for another session: a plain object, an array, a `Map` and a `Set`
 * are copied, their members as deep as they go; a `Map`'s keys, a `Set`'s
 * members and every other object are shared.
 */
export function copied(value: unknown, seen: Map<object, unknown>): unknown {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  if (seen.has(value)) return seen.get(value);
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype === Map.prototype) {
    const map = new Map<unknown, unknown>();
    seen.set(value, map);
    for (const [key, entry] of value as Map<unknown, unknown>) map.set(key, copied(entry, seen));
    return map;
  }
  if (prototype === Set.prototype) {
    const set = new Set(value as Set<unknown>);
    seen.set(value, set);
    return set;
  }
  if (prototype === Array.prototype || prototype === Object.prototype || prototype === null) {
    const object = (prototype === Array.prototype ? [] : Object.create(prototype)) as object;
    seen.set(value, object);
    // Every own key, symbols and an array's `length` among them, as it is described.
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if ('value' in descriptor) descriptor.value = copied(descriptor.value, seen);
      Object.defineProperty(object, key, descriptor);
    }
    if (!Object.isExtensible(value)) Object.preventExtensions(object);
    return object;
  }
  return value;
}
