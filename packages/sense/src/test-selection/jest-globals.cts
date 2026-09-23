/**
 * The probe log's root, in place before anything else runs in a test file's
 * sandbox.
 *
 * Named first in `setupFiles` by `withTestSelection`, ahead of the project's
 * own. A setup file that loads an instrumented module — a polyfill that pulls
 * in `src/`, a store seeded for every test — evaluates a header that reads
 * `globalThis.__VA__`, and a root installed after it is a `TypeError` in every
 * file. `setupFilesAfterEnv` is too late for that, and `@jest/globals` is not
 * available this early, which is why the journal writer in `jest-setup.cts` is
 * a second file. CommonJS on purpose: a file under `node_modules` is not
 * transformed, so an ES `import` here would be a syntax error in every project
 * that did not opt into ES modules.
 *
 * Installed once and kept. A module the registry drops and evaluates again —
 * `jest.resetModules`, `jest.isolateModules` — registers again, and what it
 * entered the first time is this file's still: under the same id and the same
 * block count it is the same module and keeps its row, and a different count
 * is a different text. This file evaluated again keeps the collector that is
 * already there for the same reason.
 *
 * There are two collectors, and the run picks one before a worker forks; both
 * are in `collectors.cts`, which the Vitest half runs too. The flat one keeps
 * one bucket for the file, which is what the file-level snapshot asks for and
 * all it asks for. The scoped one keeps a bucket per *case*, off unless the run
 * asked for it.
 *
 * The scoped one holds the case bracket two ways, and the run picks that too. A
 * suite runs its cases one at a time, so by default the case running now is a
 * variable: `enter` switches the log to the case's bucket and the body settling
 * switches it back, and the probe never asks which case is running. A second
 * case opening while one is still open is refused, because a variable cannot
 * hold two and the guess charges one case's crossings to another.
 *
 * With `continuations`, the bracket is an `AsyncLocalStorage` instead: a case's
 * continuations stay its own wherever they settle, two concurrent cases never
 * read as one — `cases.ts` argues at length why no arrangement of hooks can do
 * that — and a crossing that arrives after its case settled marks that case as
 * one whose work outlived it. It is the mode you turn on to find those, and the
 * only one where the probe asks the scope on every hit.
 */

import collectors = require('./collectors.cjs');

type Collector = ReturnType<typeof collectors.flat>;

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

type Holder = { __VA__?: unknown; [COLLECTOR]?: Collector };

function install(): Collector {
  const holder = globalThis as Holder;
  const found = holder[COLLECTOR];
  if (found !== undefined) return found;
  const collector = process.env[CASE_DIRECTORY] === undefined
    ? collectors.flat(holder)
    : collectors.scoped(holder, process.env[CONTINUATIONS] !== undefined);
  holder[COLLECTOR] = collector;
  return collector;
}

install();

export = install;
