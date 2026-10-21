/**
 * What a rewritten module imports: one frame for its variables.
 *
 * Not for hand-written code — the transform writes every call — but stable,
 * since a module transformed by one version runs against whichever version is
 * installed.
 */

import { currentSession } from './session.js';

/** How a variable was declared, which decides what reading it early does. */
export type Kind = 'let' | 'const' | 'var';

/** A module's variables, one set per session. */
export interface Frame {
  /**
   * The current session's variables, by name. `any`, because the rewrite drops
   * each declaration's type, and a type-checking transformer after it would
   * otherwise refuse every use.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly $: Record<PropertyKey, any>;
  /**
   * The same variables as their declarations write them: a write here is the
   * declaration's own, so it passes a `let` still in its dead zone and a
   * `const`. A write inside the initializer goes through {@link $} and is
   * checked, as the module would check it.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly init: Record<PropertyKey, any>;
  /** One declaration, run once, as the module reaches it. */
  step(run: () => void): void;
  /** The module finished loading: what it holds now is where every session starts. */
  loaded(): void;
}

/** One session's copy of a module's variables. */
interface Copy {
  /** The values themselves, `UNSET` until a declaration runs. */
  readonly raw: Record<string, unknown>;
  /** `raw` behind the checks the module itself would make. */
  readonly values: Record<PropertyKey, unknown>;
  /** `raw` as a declaration writes it, unchecked. */
  readonly init: Record<PropertyKey, unknown>;
}

const UNSET = Symbol('unset');

/**
 * The frame of one module. `kinds` names every variable it owns, so a read
 * before its declaration runs answers as the module would: a `let` or `const`
 * throws, a `var` is `undefined`.
 *
 * Every declaration runs once, as the module loads, and what the module holds
 * when it has loaded is kept as it is. Every session, the one it loaded in
 * too, takes a copy of that the first time it reads the module: arrays, plain
 * objects and the values of a `Map` are copied as deep as they go, one copy
 * per object, so two names for one object stay two names for one copy. What a
 * `Set` holds, a `Map`'s keys, a frozen object and an instance of a class are
 * the same objects in every session.
 */
export function frame(kinds: Readonly<Record<string, Kind>>): Frame {
  const base = create(kinds, undefined);
  const copies = new WeakMap<object, Copy>();
  let loading = true;
  let lastSession: object | undefined;
  let lastCopy: Copy = base;

  const own = (): Copy => {
    if (loading) return base;
    const session = currentSession();
    if (session === lastSession) return lastCopy;
    let copy = copies.get(session);
    if (copy === undefined) copies.set(session, (copy = create(kinds, base.raw)));
    lastSession = session;
    lastCopy = copy;
    return copy;
  };

  return {
    get $() {
      return own().values;
    },
    get init() {
      return own().init;
    },
    step(run) {
      run();
    },
    loaded() {
      loading = false;
    },
  };
}

function create(kinds: Readonly<Record<string, Kind>>, from: Readonly<Record<string, unknown>> | undefined): Copy {
  const raw = Object.create(null) as Record<string, unknown>;
  const values = Object.create(null) as Record<PropertyKey, unknown>;
  const init = Object.create(null) as Record<PropertyKey, unknown>;
  const copy: Copy = { raw, values, init };
  const seen = new Map<object, unknown>();
  for (const [name, kind] of Object.entries(kinds)) {
    raw[name] = from === undefined ? (kind === 'var' ? undefined : UNSET) : copied(from[name], seen);
    Object.defineProperty(values, name, {
      enumerable: true,
      get() {
        if (raw[name] === UNSET) throw new ReferenceError(`Cannot access '${name}' before initialization`);
        return raw[name];
      },
      set(next: unknown) {
        if (raw[name] === UNSET) throw new ReferenceError(`Cannot access '${name}' before initialization`);
        if (kind === 'const') throw new TypeError('Assignment to constant variable.');
        raw[name] = next;
      },
    });
    Object.defineProperty(init, name, {
      set(next: unknown) {
        raw[name] = next;
      },
    });
  }
  return copy;
}

/** `value` for another session: see {@link frame} for what is copied and what is shared. */
function copied(value: unknown, seen: Map<object, unknown>): unknown {
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
