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
 * asks for and all it asks for. The scoped one is a counter set per *case*,
 * handed out by an {@link AsyncLocalStorage} through a getter, so that a case's
 * continuations stay its own and two concurrent cases never read as one —
 * `cases.ts` argues at length why no arrangement of hooks can do that. It costs
 * a `Map` per case and is off unless the run asked for it.
 */

import async_hooks = require('node:async_hooks');
import type { ModuleId } from '../instrument/index.js';

type Counters = Map<ModuleId, Uint32Array>;
type Factory = (id: ModuleId, count: number) => Uint32Array;

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

/** This realm's collector, so a second evaluation of this file finds the first. */
const COLLECTOR = Symbol.for('variance-authority.test-selection.collector');

/** What the journal writer next door reads once the file is done with. */
interface Collector {
  /** Everything the file counted, whichever case entered it. */
  readonly modules: ReadonlyMap<ModuleId, Uint32Array>;
  /** What no case owns: the whole of it where cases are not recorded. */
  readonly ambient: ReadonlyMap<ModuleId, Uint32Array>;
  /** One counter set per case, the ambient bucket among them, or nothing. */
  readonly cases: ReadonlyMap<string, ReadonlyMap<ModuleId, Uint32Array>> | undefined;
}

type Holder = { __VA__?: Factory; [COLLECTOR]?: Collector };

/** A counter set that answers the same array for the same module and block count. */
function countersIn(held: Counters): Factory {
  return (id: ModuleId, count: number): Uint32Array => {
    let counters = held.get(id);
    if (counters === undefined || counters.length !== count) {
      counters = new Uint32Array(count);
      held.set(id, counters);
    }
    return counters;
  };
}

/** One counter set for the file, installed as the factory itself. */
function flat(holder: Holder): Collector {
  const modules: Counters = new Map();
  holder.__VA__ = countersIn(modules);
  return { modules, ambient: modules, cases: undefined };
}

/**
 * One counter set per case, keyed by async context.
 *
 * The emitted probe re-resolves its counter array whenever `globalThis.__VA__`
 * changes identity, so a getter over the store is all the scope a probe needs:
 * nothing about a region changes, and no bracket is maintained.
 */
function scoped(holder: Holder): Collector {
  const scopes = new async_hooks.AsyncLocalStorage<string>();
  const buckets = new Map<string, Counters>();
  const factories = new Map<string, Factory>();
  const factoryFor = (key: string): Factory => {
    let factory = factories.get(key);
    if (factory !== undefined) return factory;
    const held: Counters = new Map();
    buckets.set(key, held);
    factory = countersIn(held);
    factories.set(key, factory);
    return factory;
  };
  // Minted eagerly, so a module evaluated before any case exists finds one.
  factoryFor(AMBIENT);
  Object.defineProperty(holder, '__VA__', {
    configurable: true,
    get: () => factoryFor(scopes.getStore() ?? AMBIENT),
  });
  (holder as { [CASE_SCOPE]?: unknown })[CASE_SCOPE] = {
    enter: <Result,>(key: string, body: () => Result): Result => scopes.run(key, body),
  };

  return {
    // Presence, not arithmetic: every reader of these arrays asks only whether
    // a counter is above zero and whether it carries the evaluating bit, so the
    // union of what the cases and the ambient bucket entered is a bitwise or.
    // Summing would overflow the bit that answers the second question.
    get modules(): ReadonlyMap<ModuleId, Uint32Array> {
      const union: Counters = new Map();
      for (const held of buckets.values()) {
        for (const [id, counters] of held) {
          const into = union.get(id);
          if (into === undefined || into.length !== counters.length) {
            union.set(id, counters.slice());
            continue;
          }
          for (let at = 0; at < counters.length; at += 1) into[at]! |= counters[at]!;
        }
      }
      return union;
    },
    get ambient(): ReadonlyMap<ModuleId, Uint32Array> {
      return buckets.get(AMBIENT) ?? new Map();
    },
    cases: buckets,
  };
}

function install(): Collector {
  const holder = globalThis as Holder;
  const found = holder[COLLECTOR];
  if (found !== undefined) return found;
  const collector = process.env[CASE_DIRECTORY] === undefined ? flat(holder) : scoped(holder);
  holder[COLLECTOR] = collector;
  return collector;
}

install();

export = install;
