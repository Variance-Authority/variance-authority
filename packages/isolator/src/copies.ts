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
  /**
   * Where a module that is loading reaches the state: `first`, the copy the
   * session reads, or the base; `rest`, the base and every other live copy, which
   * its writes land in too.
   */
  loading(session: object): { first: C; rest: C[] };
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
  const alive = (): C[] => {
    sweep();
    return [...live].map((ref) => ref.deref()!);
  };
  return {
    of,
    nearest,
    loading(session) {
      const first = nearest(session) ?? base;
      const rest = first === base ? [] : [base];
      for (const copy of alive()) if (copy !== first) rest.push(copy);
      return { first, rest };
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

/** What changes an array, a `Map` or a `Set` in place, through a method of its own. */
const MUTATORS = new Map<object, ReadonlySet<PropertyKey>>([
  [Array.prototype, new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'])],
  [Map.prototype, new Set(['set', 'delete', 'clear'])],
  [Set.prototype, new Set(['add', 'delete', 'clear'])],
]);

const TARGET = Symbol('fanned');

/** An object a session copies, which a write through {@link fanned} reaches in every copy. */
function copyable(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null || prototype === Object.prototype || MUTATORS.has(prototype);
}

/**
 * `first` as a module that is loading reaches it: reads answer from `first`,
 * and a write lands in `first` and in the same place in each of `rest`, which
 * gets a copy of what is written. A `Map`'s keys and a `Set`'s members are
 * the same objects in every copy, as a copy keeps them.
 */
export function fanned<T extends object>(first: T, rest: readonly unknown[]): T {
  const into = (value: unknown, at: number): unknown => {
    const own = isFanned(value) ? value[TARGET] : value;
    return at === 0 ? own : copied(own, new Map());
  };
  return new Proxy(first, {
    get(target, key) {
      if (key === TARGET) return target;
      const value: unknown = Reflect.get(target, key);
      const prototype = Object.getPrototypeOf(target) as object | null;
      if (typeof value === 'function' && prototype !== null && MUTATORS.has(prototype) && value === Reflect.get(prototype, key)) {
        const others = rest.filter((other): other is object => copyable(other) && Object.getPrototypeOf(other) === prototype);
        const method = value as (...args: unknown[]) => unknown;
        if (MUTATORS.get(prototype)!.has(key)) {
          return (...args: unknown[]) => {
            const copiedArgs = (at: number) =>
              args.map((arg, index) => (prototype === Set.prototype || (prototype === Map.prototype && index === 0) ? into(arg, 0) : into(arg, at)));
            for (const other of others) method.apply(other, copiedArgs(1));
            return method.apply(target, copiedArgs(0));
          };
        }
        if (prototype === Map.prototype && key === 'get') {
          return (entry: unknown) => {
            const found = (target as Map<unknown, unknown>).get(entry);
            return copyable(found) ? fanned(found, others.map((other) => (other as Map<unknown, unknown>).get(entry))) : found;
          };
        }
        return method.bind(target);
      }
      if (typeof value === 'function' && prototype !== null && MUTATORS.has(prototype)) return value;
      return copyable(value) ? fanned(value, rest.map((other) => (copyable(other) ? Reflect.get(other, key) : undefined))) : value;
    },
    set(target, key, value: unknown) {
      if (!Reflect.set(target, key, into(value, 0))) return false;
      for (const other of rest) if (copyable(other)) Reflect.set(other, key, into(value, 1));
      return true;
    },
    deleteProperty(target, key) {
      for (const other of rest) if (copyable(other)) Reflect.deleteProperty(other, key);
      return Reflect.deleteProperty(target, key);
    },
  });
}

function isFanned(value: unknown): value is { [TARGET]: unknown } {
  return typeof value === 'object' && value !== null && (value as { [TARGET]?: unknown })[TARGET] !== undefined;
}
