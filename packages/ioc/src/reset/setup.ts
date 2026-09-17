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
const runAll = (state: ResetRealm): void => {
  const failures: unknown[] = [];

  for (const handler of Array.from(state.handlers)) {
    try {
      handler();
    } catch (failure) {
      failures.push(failure);
    }
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, `${failures.length} reset handlers failed`);
};

/**
 * Install the driver that runs every registered handler before each test.
 *
 * Hand it the runner's own per-test hook. This is the only thing that makes
 * [`registerResetHandler`](./index.ts) do anything, which is what keeps the
 * registration side free to ship.
 *
 * ```ts
 * import { beforeEach } from 'vitest';
 * import { configureResetHandler } from '@variance-authority/ioc/reset/setup';
 *
 * configureResetHandler(beforeEach);
 * ```
 *
 * **`beforeEach`, not `afterEach`.** A failing test does run its `afterEach`;
 * that is the hook's contract. Resetting on the way in instead buys two things.
 * The state a failure left behind is still there when a reporter or a snapshot
 * serializer reads it, rather than being erased between the failure and the
 * report. And a reset on entry does not depend on the previous test having
 * finished — a worker that died on an unhandled rejection, or a run somebody
 * stopped, skips its teardown and leaves the next file to inherit whatever was
 * set.
 *
 * What it does not give you is a clean slate *between files*: a module that
 * reads state while it is being imported is running before any hook, and sees
 * whatever the previous file left.
 *
 * @throws if any handler registered before this call — see the message, which
 * names the first one. The check is unconditional and has no opt-out: a handler
 * that registered early is not installed, and a suite that silently does not
 * reset is the failure this package was added to remove.
 */
export const configureResetHandler = (each: EachHook): void => {
  const state = realm();

  if (state.earlyCount > 0) throw misordered(state);

  state.configured = true;
  each(() => {
    runAll(state);
  });
};
