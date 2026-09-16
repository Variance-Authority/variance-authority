import { realm, type ResetHandler } from './state.js';

export type { ResetHandler } from './state.js';

/** Returned when nothing was registered, so the caller's contract is uniform. */
const nothingToUndo = (): void => {};

/**
 * Declare how to return a module's own state to its initial value.
 *
 * Call it beside the state it resets, at module scope, in the module that owns
 * it — a counter, a cache, a lazily built client, a memoized value. Nothing
 * happens until a test setup installs a driver with
 * [`configureResetHandler`](./setup.ts); until then this records that somebody
 * asked and returns.
 *
 * ```ts
 * let counter = 0;
 * registerResetHandler(() => { counter = 0; });
 * ```
 *
 * ## Why this is safe to ship
 *
 * The gate is *whether a driver was installed*, which is a runtime fact, and not
 * *which mode this was built in*, which is not the same question. A static
 * Storybook build is a production build and it is exactly where a collector runs
 * a suite, so a `NODE_ENV` gate would disable resets in the one environment that
 * needs them. Keyed on the driver instead, a shipped application pays one
 * boolean comparison per registration, and the handler set is never written, so
 * no handler is ever run outside a suite.
 *
 * What is kept without a driver is a count and the *first* handler to arrive —
 * the function, never a stack, because a stack per call is a cost a shipped
 * application would pay on every module it loads. That one reference is retained
 * for the life of the realm, which is the whole cost of shipping this: a single
 * closure, so that a misordered test setup can be named rather than guessed at.
 *
 * ## What a handler must be
 *
 * **Idempotent.** Running a reset twice has to be the same as running it once.
 * Two setup files can both install a driver, and rather than guess which of them
 * is a duplicate and which is a new test file's setup — indistinguishable from
 * inside this realm, and guessing wrong silently drops every reset for that file
 * — both are honoured and the handlers run twice. That is only harmless because
 * a reset assigns a known value rather than stepping a state machine.
 *
 * @returns a function that unregisters this handler.
 */
export const registerResetHandler = (handler: ResetHandler): (() => void) => {
  const state = realm();

  if (!state.configured) {
    state.earlyCount += 1;
    state.early ??= handler;
    return nothingToUndo;
  }

  state.handlers.add(handler);
  return () => {
    state.handlers.delete(handler);
  };
};
