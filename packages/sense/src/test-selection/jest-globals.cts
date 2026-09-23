/**
 * The `globalThis.__VA__` factory, in place before anything else runs in a test
 * file's sandbox.
 *
 * Named first in `setupFiles` by `withTestSelection`, ahead of the project's
 * own. A setup file that loads an instrumented module — a polyfill that pulls
 * in `src/`, a store seeded for every test — evaluates a header that resolves
 * this factory, and a factory installed after it is a `TypeError` in every
 * file. `setupFilesAfterEnv` is too late for that, and `@jest/globals` is not
 * available this early, which is why the journal writer in `jest-setup.cts` is
 * a second file. CommonJS on purpose: a file under `node_modules` is not
 * transformed, so an ES `import` here would be a syntax error in every project
 * that did not opt into ES modules.
 *
 * Installed once and kept. A module the registry drops and evaluates again —
 * `jest.resetModules`, `jest.isolateModules` — resolves the factory again, and
 * what it counted the first time is this file's still: fresh counters would
 * replace them with zeros and the test that entered a region before the reset
 * would be read as never having entered it. Under the same id and the same
 * block count it is the same module, and the counters carry on; a different
 * count is a different text. This file evaluated again keeps the factory that
 * is already there for the same reason.
 *
 * There are two collectors, and the run picks one before a worker forks. The
 * flat one is a counter set for the file, which is what the file-level snapshot
 * asks for and all it asks for. The scoped one is a counter set per *case*, off
 * unless the run asked for it.
 *
 * The scoped one holds the case bracket two ways, and the run picks that too. A
 * suite runs its cases one at a time, so by default the case running now is a
 * variable: `enter` assigns it and the body settling restores it, which is a
 * closure slot for the probe to read and costs what the flat collector costs. A
 * second case opening while one is still open is refused, because a variable
 * cannot hold two and the guess charges one case's crossings to another.
 *
 * With `continuations`, the bracket is an {@link AsyncLocalStorage} instead: a
 * case's continuations stay its own wherever they settle, two concurrent cases
 * never read as one — `cases.ts` argues at length why no arrangement of hooks
 * can do that — and a crossing that arrives after its case settled marks that
 * case as one whose work outlived it. It is the mode you turn on to find those.
 */

import async_hooks = require('node:async_hooks');
import journals = require('./journal-format.cjs');
import type { ModuleId } from '../instrument/index.js';

type Counters = Map<ModuleId, Uint32Array>;
type Factory = ((id: ModuleId, count: number) => Uint32Array) & {
  /**
   * Which factory owns the async scope running now, where one is scoped.
   *
   * The probe reads this on every hit, so every collector declares it — empty
   * spelled `undefined` rather than missing — and that load reads one shape
   * whichever collector is installed. `instrument/index.ts` has the reading.
   */
  s?: (() => Factory) | undefined;
  /** The case coordinate this factory was minted under; the scoped collector's. */
  key?: string;
  /** Whether that case is still running, which is how a late crossing is spotted. */
  open?: boolean;
  /** Whether its bucket is written and dropped, so a late crossing needs another. */
  closed?: boolean;
  /** How many modules are evaluating under this factory; the probe keeps it. */
  e?: number;
};

/** What a case frame calls the bucket no case owns; mirrors `AMBIENT` in `cases.ts`. */
const AMBIENT = '';

/** Where the runner half of the seam finds the scope; mirrors `CASE_SCOPE` in `cases.ts`. */
const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');

/**
 * Set by the reporter before the workers fork, to the directory case frames go
 * to. Mirrors `CASE_DIRECTORY_VARIABLE` in `jest.ts`, which a CommonJS file in
 * the sandbox cannot import.
 */
const CASE_DIRECTORY = 'VARIANCE_AUTHORITY_TEST_SELECTION_CASES';

/**
 * Set beside it when the case bracket is an async context rather than a
 * variable. Mirrors `CONTINUATIONS_VARIABLE` in `jest.ts`.
 */
const CONTINUATIONS = 'VARIANCE_AUTHORITY_TEST_SELECTION_CONTINUATIONS';

/** This realm's collector, so a second evaluation of this file finds the first. */
const COLLECTOR = Symbol.for('variance-authority.test-selection.collector');

/** What the journal writer next door reads once the file is done with. */
interface Collector {
  /** Whether a counter set is kept per case. */
  readonly scoped: boolean;
  /**
   * What had run before the file's first test, closed as a record of its own.
   *
   * Called once, from the first `beforeAll`. The scoped collector writes it as
   * an ambient frame there and starts a fresh ambient bucket, so what loading
   * counted is held once rather than copied and held twice.
   */
  seal(testFile: string): ReadonlyMap<ModuleId, Uint32Array>;
  /**
   * Everything the file counted, whichever case entered it, and a frame per
   * bucket where cases are recorded. Closes every bucket still open.
   */
  finish(testFile: string): {
    readonly modules: ReadonlyMap<ModuleId, Uint32Array>;
    readonly frames: readonly Uint8Array[] | undefined;
  };
  /**
   * The cases that made a crossing after they had settled.
   *
   * Empty in the mode that cannot see one: a variable has no memory of a case
   * that closed, so a late crossing lands in the ambient bucket unnamed.
   */
  runaways(): readonly string[];
}

type Holder = { __VA__?: Factory; [COLLECTOR]?: Collector };

/**
 * The coordinate is `file\0declaration path\0ordinal`; a reader knows a case by
 * the middle one, and the ambient bucket by the only one it has.
 */
const nameOf = (key: string): string => key.split('\u0000')[1] || key.split('\u0000')[0] || AMBIENT;

const twoAtOnce = (open: string, opening: string): Error =>
  new Error(
    `variance-authority: ${nameOf(open)} was still running when ${nameOf(opening)} started. ` +
      'Per-case recording holds one case at a time, which is two cases open at once — a ' +
      'concurrent group, or a case that left work behind. Record with ' +
      '{ cases: true, continuations: true }: it follows every case through the async context ' +
      'and names the ones whose work outlived them.',
  );

/** A counter set that answers the same array for the same module and block count. */
function countersIn(held: Counters): Factory {
  const factory: Factory = (id: ModuleId, count: number): Uint32Array => {
    let counters = held.get(id);
    if (counters === undefined || counters.length !== count) {
      counters = new Uint32Array(count);
      held.set(id, counters);
    }
    return counters;
  };
  return factory;
}

/** One counter set for the file, installed as the factory itself. */
function flat(holder: Holder): Collector {
  const modules: Counters = new Map();
  const factory = countersIn(modules);
  factory.s = undefined;
  holder.__VA__ = factory;
  return {
    scoped: false,
    // The same arrays keep counting after this, so the snapshot is a copy.
    seal: () => new Map([...modules].map(([id, counters]) => [id, counters.slice()])),
    finish: () => ({ modules, frames: undefined }),
    runaways: () => [],
  };
}

/**
 * Presence, not arithmetic: every reader of these arrays asks only whether a
 * counter is above zero and whether it carries the evaluating bit, so the union
 * of what the cases and the ambient bucket entered is a bitwise or. Summing
 * would overflow the bit that answers the second question.
 */
function fold(into: Counters, held: ReadonlyMap<ModuleId, Uint32Array>): void {
  for (const [id, counters] of held) {
    const union = into.get(id);
    if (union === undefined || union.length !== counters.length) {
      into.set(id, counters.slice());
      continue;
    }
    for (let at = 0; at < counters.length; at += 1) union[at]! |= counters[at]!;
  }
}

/**
 * One counter set per case.
 *
 * The emitted probe re-resolves its counter array whenever the factory it holds
 * changes identity, so a resolver on the factory is all the scope a probe
 * needs: nothing about a region changes, and no bracket is maintained. It hangs
 * off the factory rather than replacing `__VA__` with an accessor on the realm,
 * which is where this axis spent almost all of its cost — see
 * `instrument/index.ts`.
 *
 * @param continuations Hold the bracket in an async context rather than a
 * variable, and mark the cases whose work outlived them.
 */
function scoped(holder: Holder, continuations: boolean): Collector {
  const buckets = new Map<string, Counters>();
  const factories = new Map<string, Factory>();
  const late = new Set<string>();
  // A bucket is written the moment its case settles and then dropped, so a
  // worker holds one case's counters and the file's union, never every case
  // until `afterAll`: a file of a thousand cases held a counter array per case
  // per module it touched, almost all zeros, for as long as the file ran.
  const union: Counters = new Map();
  const frames: Uint8Array[] = [];
  const close = (key: string, name: string): Counters => {
    const held = buckets.get(key) ?? new Map();
    const factory = factories.get(key);
    if (factory !== undefined) factory.closed = true;
    buckets.delete(key);
    factories.delete(key);
    if (held.size === 0) return held;
    frames.push(journals.encodeJournal(name, held));
    fold(union, held);
    return held;
  };
  const factoryFor = (key: string): Factory => {
    let factory = factories.get(key);
    if (factory !== undefined) return factory;
    const held: Counters = new Map();
    buckets.set(key, held);
    factory = countersIn(held);
    factory.key = key;
    factory.open = true;
    factory.s = resolve;
    factories.set(key, factory);
    return factory;
  };

  // The store holds the factory, not the key it was minted under: the probe
  // asks on every hit, and a `Map.get` on a case coordinate is most of what
  // asking costs once the accessor is gone.
  const scopes = continuations ? new async_hooks.AsyncLocalStorage<Factory>() : undefined;
  // One case at a time, so the case running now is a variable and the probe
  // reads a closure slot for it.
  let current: Factory;
  const resolve = (): Factory => {
    if (scopes === undefined) return current;
    const factory = scopes.getStore();
    if (factory === undefined) return ambientFactory;
    if (factory.open !== false) return factory;
    // A crossing under a case that has already settled is that case still
    // working, which is the whole reason this mode exists.
    const key = factory.key ?? AMBIENT;
    late.add(key);
    if (factory.closed !== true) return factory;
    // Its bucket is written already, so the late work opens a second under the
    // same key, and the reader joins the two frames into one case.
    const again = factoryFor(key);
    again.open = false;
    return again;
  };
  const release = (factory: Factory): void => {
    factory.open = false;
    if (current === factory) current = ambientFactory;
    if (factory.closed !== true) close(factory.key ?? AMBIENT, factory.key ?? AMBIENT);
  };
  // A case is over when its body settles, not when it returns: an async case
  // returns a promise at its first await and everything past that await is
  // still the case. A synchronous one has no promise and is over on return.
  const settling = <Result,>(factory: Factory, body: () => Result): Result => {
    let answered: Result;
    try {
      answered = body();
    } catch (thrown) {
      release(factory);
      throw thrown;
    }
    const thenable = answered as { then?: unknown } | null | undefined;
    if (thenable == null || typeof thenable.then !== 'function') {
      release(factory);
      return answered;
    }
    return (answered as unknown as Promise<unknown>).then(
      (value) => { release(factory); return value; },
      (thrown: unknown) => { release(factory); throw thrown; },
    ) as unknown as Result;
  };
  const enter = <Result,>(key: string, body: () => Result): Result => {
    const factory = factoryFor(key);
    factory.open = true;
    if (scopes !== undefined) return scopes.run(factory, () => settling(factory, body));
    if (current !== ambientFactory) throw twoAtOnce(current.key ?? AMBIENT, key);
    current = factory;
    return settling(factory, body);
  };

  // Minted eagerly, so a module evaluated before any case exists finds one. It
  // stays the realm's root after `seal` replaces it as the ambient bucket: a
  // probe reads the root once and asks its `s` from then on.
  let ambientFactory = factoryFor(AMBIENT);
  current = ambientFactory;
  holder.__VA__ = ambientFactory;
  (holder as { [CASE_SCOPE]?: unknown })[CASE_SCOPE] = { enter };

  const ambientKey = (testFile: string): string => journals.packCase(testFile, '', '');
  return {
    scoped: true,
    seal(testFile) {
      const before = ambientFactory;
      const loaded = close(AMBIENT, ambientKey(testFile));
      // A new identity, not a new map behind the old one: a probe keeps the
      // array it resolved until the factory it resolved changes.
      ambientFactory = factoryFor(AMBIENT);
      if (before.e !== undefined) ambientFactory.e = before.e;
      if (current === before) current = ambientFactory;
      return loaded;
    },
    finish(testFile) {
      for (const key of buckets.keys()) close(key, key === AMBIENT ? ambientKey(testFile) : key);
      return { modules: union, frames };
    },
    runaways: () => [...late].map(nameOf),
  };
}

function install(): Collector {
  const holder = globalThis as Holder;
  const found = holder[COLLECTOR];
  if (found !== undefined) return found;
  const collector = process.env[CASE_DIRECTORY] === undefined
    ? flat(holder)
    : scoped(holder, process.env[CONTINUATIONS] !== undefined);
  holder[COLLECTOR] = collector;
  return collector;
}

install();

export = install;
