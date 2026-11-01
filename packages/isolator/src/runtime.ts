/**
 * What a rewritten module imports: one frame for its variables.
 *
 * Not for hand-written code — the transform writes every call — but stable,
 * since a module transformed by one version runs against whichever version is
 * installed.
 */

import { copied, copies, fanned } from './copies.js';
import { endLoad, inEverySession, startLoad } from './realm.js';
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
  startLoad();
  const base = create(kinds, undefined);
  const held = copies(base, (from) => create(kinds, from.raw));
  let loading = true;
  let lastSession: object | undefined;
  let lastCopy: Copy = base;

  // Another module running its top level writes into every session, the load
  // and each copy already made, as it would on every fresh page that loads it;
  // it reads what the current session holds.
  const everywhere = (): Copy => {
    const { first, rest } = held.loading(currentSession());
    return { raw: first.raw, values: fanned(first.values, rest.map((copy) => copy.raw)), init: first.init };
  };

  const own = (): Copy => {
    if (loading) return base;
    const session = currentSession();
    if (inEverySession(session)) return everywhere();
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
      endLoad();
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
