/**
 * What a rewritten module imports: one frame for its variables.
 *
 * Not for hand-written code — the transform writes every call — but stable,
 * since a module transformed by one version runs against whichever version is
 * installed.
 */

import { copies } from './copies.js';
import { realm } from './realm.js';
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
 * before its declaration runs answers as the module would. Every session copies
 * what the module held once it loaded (see {@link copied}); what another module
 * writes as it loads lands in that and in every copy already made.
 */
export function frame(kinds: Readonly<Record<string, Kind>>): Frame {
  const state = realm();
  // A top level runs to its end in one turn, since a module that awaits is never
  // rewritten: one that threw before `loaded()` stops counting at the next.
  if (state.loading++ === 0) queueMicrotask(() => (state.loading = 0));
  const base = create(kinds, undefined);
  const held = copies(base, (from) => create(kinds, from.raw));
  let loading = true;
  let lastSession: object | undefined;
  let lastCopy: Copy = base;

  // Another module running its top level writes into every session, the load
  // and each copy already made, as it would on every fresh page that loads it;
  // it reads what the current session holds.
  const everywhere = (): Copy => {
    const first = held.nearest(currentSession()) ?? base;
    const rest: Copy[] = first === base ? [] : [base];
    for (const copy of held.live()) if (copy !== first) rest.push(copy);
    return { raw: first.raw, values: fanned(first.values, rest.map((copy) => copy.raw)), init: first.init };
  };

  const own = (): Copy => {
    if (loading) return base;
    if (realm().loading > 0) return everywhere();
    const session = currentSession();
    if (session === lastSession) return lastCopy;
    const copy = held.of(session);
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
      state.loading = Math.max(0, state.loading - 1);
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
function fanned<T extends object>(first: T, rest: readonly unknown[]): T {
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
