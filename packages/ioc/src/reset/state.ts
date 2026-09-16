/**
 * The registry both entrypoints share, and the reason it does not live here.
 *
 * A module-scoped `let` is the obvious home for this state and it is the wrong
 * one, because the question it answers — *has a test setup installed a driver?*
 * — has to be answerable from a copy of this module that the app imported, and
 * there is no guarantee the app's copy is the setup file's copy. Three ordinary
 * configurations break that assumption: `jest.resetModules()` empties the module
 * registry between tests, a dual CJS/ESM resolution hands the setup file and the
 * application two instances, and a runner that builds a fresh module graph per
 * test file does the same again. In every one of them a module-scoped flag reads
 * `false` in a correctly configured suite, which would turn a working setup into
 * a thrown error or a silent no-op.
 *
 * A well-known symbol on `globalThis` survives all three: the module registry is
 * reset, the realm is not.
 */
export type ResetHandler = () => void;

export interface ResetRealm {
  /** Whether a test setup has installed a driver in this realm. */
  configured: boolean;
  /** The handlers a reset will run, read at reset time so late imports count. */
  handlers: Set<ResetHandler>;
  /** The first handler that registered before a driver existed, for the error. */
  early: ResetHandler | undefined;
  /** How many did, so the error can say whether it is one module or forty. */
  earlyCount: number;
}

const REALM = Symbol.for('@variance-authority/ioc/reset');

type Host = typeof globalThis & { [REALM]?: ResetRealm };

/**
 * The realm's registry, created on first use.
 *
 * Reached on every `registerResetHandler` call, including in a production build
 * where no driver will ever be installed, so it stays a property read and an
 * allocation that happens once.
 */
export const realm = (): ResetRealm => {
  const host = globalThis as Host;
  return (host[REALM] ??= { configured: false, handlers: new Set(), early: undefined, earlyCount: 0 });
};
