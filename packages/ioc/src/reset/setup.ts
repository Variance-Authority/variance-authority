import { realm, type ResetHandler, type ResetRealm } from './state.js';

/**
 * A per-test registrar: `beforeEach` from Vitest, Jest, Mocha or Playwright.
 *
 * Typed as the shape those hooks share rather than imported from any of them,
 * so this package depends on no runner and works with one it has never heard of.
 */
export type EachHook = (run: () => void) => unknown;

/** Enough of a handler to recognise, for a reader holding a misordered setup. */
const describe = (handler: ResetHandler): string => {
  const source = handler.toString().replace(/\s+/g, ' ').trim();
  return handler.name !== '' ? `${handler.name}: ${source.slice(0, 96)}` : source.slice(0, 120);
};

const misordered = (state: ResetRealm): Error =>
  new Error(
    `@variance-authority/ioc/reset: ${state.earlyCount} handler(s) registered before this setup ran, ` +
      `and they are not installed. The first was — ${describe(state.early!)}\n\n` +
      `A handler registers when its module is imported, so a module imported before this call ` +
      `has already asked and been refused. Move the import of this setup file above every ` +
      `application module: in Vitest and Jest, make it the first entry in setupFiles; in ` +
      `Playwright, the first import of the fixture file.`,
  );

/**
 * Run every registered handler, and let one failure not hide the rest.
 *
 * A `forEach` that propagates the first throw would skip every later reset,
 * which leaves exactly the order-dependent state this package exists to clear —
 * one broken handler turning into a flake somewhere else entirely. So all of
 * them run and the failures are reported together.
 *
 * The snapshot is taken because a handler may import a module, and a module may
 * register.
 */
const runAll = (calls: Iterable<() => void>): void => {
  const failures: unknown[] = [];

  for (const call of Array.from(calls)) {
    try {
      call();
    } catch (failure) {
      failures.push(failure);
    }
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, `${failures.length} reset handlers failed`);
};

/** Every scope's `member`, as calls, read when the driver runs. */
const entering = (state: ResetRealm, member: 'enterFile' | 'enterTest' | 'leaveTest'): Array<() => void> =>
  Array.from(state.scopes, (scope) => () => scope[member]());

/**
 * Install the driver on the runner's `beforeEach`, and on its `afterEach` as
 * `after`: `configureResetHandler(beforeEach, afterEach)`. It is the only thing
 * that makes [`registerResetHandler`](./index.ts) do anything. Why the reset
 * runs on the way in is in the package README.
 *
 * @throws if a handler or a scope registered before this call, naming the first.
 * @throws a `TypeError` without `after`: a driver that never hears a test end
 *   would leave a nested `describe`'s `beforeAll` writing into the test before it.
 */
export const configureResetHandler = (each: EachHook, after: EachHook): void => {
  const state = realm();

  if (typeof after !== 'function') {
    throw new TypeError("configureResetHandler takes the runner's afterEach as its second argument: configureResetHandler(beforeEach, afterEach).");
  }
  if (state.earlyCount > 0) throw misordered(state);

  state.configured = true;
  // A setup file runs again for every test file, before the file is collected: a file starts here.
  runAll(entering(state, 'enterFile'));
  each(() => {
    runAll([...entering(state, 'enterTest'), ...state.handlers]);
  });
  // FIXME: Jest runs a test file's top-level `afterEach` after this one, so a scope hears the test end before that hook writes.
  // A custom `testEnvironment` hears `test_done` after every hook; it would be a second thing every Jest setup installs.
  // FIXME: Vitest runs `beforeEach` cleanups and fixture teardown after this hook, so what they write lands in the file.
  // FIXME: under Vitest `sequence.hooks: 'list'` or `'parallel'` this hook no longer runs last, with the same effect.
  after(() => {
    runAll(entering(state, 'leaveTest'));
  });
};
