/**
 * An object with one set of own properties per session, behind a proxy that
 * stands where the object stood: `process.env`, a registry on `globalThis`,
 * any object no transform reaches.
 */

import { copied, copies, fanned } from './copies.js';
import { inEverySession } from './realm.js';
import { currentSession } from './session.js';

/** How {@link perSession} writes a value. */
export interface PerSessionOptions {
  /** What a write stores, as the object itself would store it: `String` for `process.env`. */
  readonly store?: (value: unknown) => unknown;
  /** Told after a write or a delete of `key` lands: a write the host has to see too. */
  readonly wrote?: (key: PropertyKey) => void;
}

/**
 * `object` with one set of own properties per session. A session starts from
 * a copy of what its parent held, and the first session from the object
 * itself; a write lands in the current session's copy. What a rewritten module
 * writes as it loads lands in the object and in every copy, as it would on
 * every fresh page that loads it. Values are copied as frames copy them.
 *
 * The object itself is the base, so whatever reads it directly — native code,
 * a reference kept from before — sees what it held before any session wrote.
 */
export function perSession<T extends object>(object: T, options: PerSessionOptions = {}): T {
  const store = options.store ?? ((value: unknown) => value);
  const held = copies<object>(object, (from) => snapshot(from));
  const own = (): object => held.of(currentSession());
  const loading = () => inEverySession(currentSession());
  // A loading module reads what the current session holds, without making it a
  // copy, and writes, as deep as it goes, into the object and every copy.
  const read = (): object => {
    if (!loading()) return own();
    const { first, rest } = held.loading(currentSession());
    return fanned(first, rest);
  };
  return new Proxy(Object.create(Object.getPrototypeOf(object) as object | null) as T, {
    get: (_, key) => Reflect.get(read(), key),
    has: (_, key) => Reflect.has(read(), key),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor(_, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(read(), key);
      // The proxy's own target holds none of these keys, so none may be reported fixed.
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true };
    },
    set(_, key, value: unknown) {
      const stored = store(value);
      Reflect.set(read(), key, stored);
      options.wrote?.(key);
      return true;
    },
    defineProperty(_, key, descriptor) {
      // A key fixed on the proxy would have to be fixed on its own target, which holds none.
      if (descriptor.configurable === false) return false;
      if (loading()) {
        const { first, rest } = held.loading(currentSession());
        for (const copy of [first, ...rest]) Reflect.defineProperty(copy, key, copy === object ? descriptor : { ...descriptor, configurable: true });
        return true;
      }
      return Reflect.defineProperty(own(), key, { ...descriptor, configurable: true });
    },
    deleteProperty(_, key) {
      const deleted = Reflect.deleteProperty(read(), key);
      options.wrote?.(key);
      return deleted;
    },
  });
}

/** Every own property of `from`, each value copied, on a plain object, shared references and cycles kept. */
function snapshot(from: object): object {
  const into = Object.create(null) as Record<PropertyKey, unknown>;
  // One map for the whole object: what two properties share, their copies share.
  const seen = new Map<object, unknown>([[from, into]]);
  for (const key of Reflect.ownKeys(from)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(from, key)!;
    if ('value' in descriptor) descriptor.value = copied(descriptor.value, seen);
    Reflect.defineProperty(into, key, { ...descriptor, configurable: true });
  }
  return into;
}
