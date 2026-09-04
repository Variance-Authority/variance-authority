import { isOwnerFrame, type Fiber } from './fiber.js';
import { fiberComponentName } from './names.js';
import {
  memoizedUpdatersOf,
  type CommitUpdater,
  type FiberRootUpdate,
} from './updaters.js';

/**
 * Every commit React makes, and which components rendered in it.
 *
 * This exists to replace a guess that the whole industry makes. Playwright's
 * `toHaveScreenshot` stabilizes a page by taking "a bunch of screenshots until
 * two consecutive screenshots matched" — a poll in *pixel* space for the
 * proposition *the page has stopped moving*. It costs a paint per sample, it
 * cannot see a change that two samples straddle, and when it gives up it can
 * name nothing: the output is a timeout, not a component.
 *
 * A React page does not have to be asked that way. A commit is the moment work
 * reaches the DOM, React announces every one of them, and the committed tree
 * says which components did the work. So the same question — *has it stopped* —
 * becomes a fact rather than a sample, and the interesting failure changes shape
 * entirely:
 *
 * ```text
 * still committing after 500ms: Clock ×31, PriceTicker ×31
 * ```
 *
 * That is the sentence `docs/flakiness.md` wants everywhere: not "this subject
 * is flaky" but a component and a count. A page that never goes quiet is the
 * cause of a flake *before* any image has been taken, which is one build earlier
 * than a second reading can find it.
 *
 * ## What it costs to be allowed to see this
 *
 * The one thing on this page that is not free. Everything else in this package
 * reads state React left lying around; a commit is an *event*, and the only
 * announcement of it is `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot`,
 * which `react-dom` binds when its module body runs. So the hook has to exist
 * **before React loads** — an init script, not a call made from a test.
 *
 * That breaks the package's standing rule that the hook is never a
 * precondition, and the break is contained here rather than waived: this module
 * is the only one that needs it, `attached` is false when it did not get it, and
 * a refusal carries a reason. Zero commits and "no tap" must never look alike —
 * a page that is on fire and a page nobody instrumented both report silence,
 * and only one of them is quiet.
 */

/**
 * `PerformedWork` — the flag React sets on a fiber that actually rendered.
 *
 * INTERNAL CONTRACT, and the reason this module can name components rather than
 * count events. It is `0b1` in `ReactFiberFlags.js` and has been the first bit
 * since fibers existed; React DevTools' own `didFiberRender` reads it the same
 * way. `bubbleProperties` folds a child's flags into its parent's `subtreeFlags`,
 * which is what makes the walk below prunable.
 *
 * Verified on React 19.2.8: mounting `Shell → Restless + memo(Quiet)` names all
 * three, and each subsequent state update in `Restless` names `Restless` alone —
 * the memoised sibling that bailed out is correctly absent.
 *
 * If React renumbers the bit, the symptom is a commit that names nothing, or
 * names everything. Both are visible in the output rather than silent, because
 * the commit itself is still recorded and its component list is what changes.
 */
const PERFORMED_WORK = 0b1;

/** Runaway guard on the per-commit walk. See `suspense.ts` for the same bound. */
const MAX_FIBERS = 500_000;

/** How many component names one commit may contribute before it is truncated. */
const DEFAULT_NAME_LIMIT = 64;

/** How many commits are retained. Oldest are dropped, and the drop is counted. */
const DEFAULT_KEEP = 512;

/** A portable record of one React commit, copied before the renderer moves on. */
export interface Commit {
  /** Milliseconds since the tap attached, from the page's monotonic clock. */
  readonly at: number;

  /**
   * Composite components that rendered in this commit, outermost first.
   *
   * Host elements are excluded for the reason the owner chain excludes them:
   * nobody adjudicates a `<div>`. A commit that moved only host nodes therefore
   * reports an empty list, which is a real answer — React committed something no
   * component re-rendered for, which is a `ref` or a hydration step.
   */
  readonly components: readonly string[];

  /**
   * Fibers that initiated this commit, when React exposed `memoizedUpdaters`.
   *
   * Absent means the renderer did not expose the set. An empty array means it
   * did and no composite updater initiated this commit, as on an initial mount.
   */
  readonly updaters?: readonly CommitUpdater[];

  /** Set when `nameLimit` cut the list short. Absent means the list is complete. */
  readonly truncated?: boolean;

  /** Set when `updaterLimit` cut the initiator list short. */
  readonly updatersTruncated?: boolean;
}

/**
 * Why no tap was installed, carried so silence can be read.
 *
 * A run that records no commits has two unrelated explanations — nothing
 * rendered, or nobody was listening — and the whole point of `attached` is that
 * they never look alike. Each member below names the distinct moment at which
 * the hook was already out of reach.
 */
export type TapRefusal =
  /**
   * No hook existed and React had already mounted something, so `react-dom` has
   * long since decided there was nobody to tell. Installing one now would
   * produce a tap that reports silence forever.
   */
  | 'react-already-loaded'
  /**
   * A hook exists but does not look like one `react-dom` talks to. Wrapping it
   * would be writing over somebody else's object for no benefit.
   */
  | 'unrecognised-hook'
  /**
   * No hook existed and the caller declined to install one.
   *
   * The refusal a caller reached *through* React needs. `react-dom` binds the
   * hook when its module body runs, so anything that had to import the
   * application's own React to get here is already past the only moment an
   * installed hook is read. Writing one anyway succeeds, and produces a tap
   * attached to an object nothing will ever call: `attached` true, commits
   * absent forever, and no way to tell that from a page that made none.
   */
  | 'no-hook';

export interface CommitTap {
  /** False when nothing was instrumented. Never confuse with "no commits". */
  readonly attached: boolean;
  /** Why not, when `attached` is false. */
  readonly reason?: TapRefusal;

  /**
   * Exact `react-dom` version, when a renderer has injected one.
   *
   * Read on access, not captured at attach. The tap is installed *before* React
   * loads by construction, so at attach time no renderer has introduced itself
   * and a snapshot taken then is permanently `undefined` — which would report
   * "no React" for every page the tap was correctly installed on.
   */
  readonly reactVersion?: string | undefined;

  /** Commits recorded so far, oldest first. */
  commits(): readonly Commit[];
  /** How many commits were dropped by the retention bound. */
  dropped(): number;
  /** Milliseconds since the last commit, or since attaching if there were none. */
  quietFor(): number;
  /** Restore whatever was there before. Safe to call twice. */
  stop(): void;
}

export interface TapOptions {
  /** Where the hook lives. Injectable so a test can use a scope of its own. */
  readonly scope?: Record<string, unknown>;
  readonly nameLimit?: number;
  /** How many update initiators one commit may retain. Defaults to 64. */
  readonly updaterLimit?: number;
  readonly keep?: number;
  /** Observe each retained commit synchronously. A failure never breaks the page. */
  readonly onCommit?: (commit: Commit) => void;
  /**
   * Whether a page that has already mounted React is a refusal.
   *
   * Default true, and it should stay true in a collector. Turn it off only when
   * something else guarantees the hook was installed first and the containers
   * present belong to a root this tap will still hear from — a Storybook iframe
   * that remounts per story is the case that motivates the option.
   */
  readonly refuseIfLoaded?: boolean;
  /**
   * Whether a missing hook may be installed.
   *
   * Default true, which is only correct where this runs before `react-dom` does
   * — an init script, or a runner setup file loaded ahead of the suite. A caller
   * that cannot promise it was first passes false and reads `'no-hook'`.
   */
  readonly createHook?: boolean;
}

const HOOK_KEY = '__REACT_DEVTOOLS_GLOBAL_HOOK__';
const CONTAINER_KEY_PREFIX = '__reactContainer$';

interface DevToolsHook {
  renderers?: Map<number, { version?: string }>;
  supportsFiber?: boolean;
  inject?: (internals: unknown) => number;
  // `| undefined` in the value type, not only optional: `stop()` restores
  // whatever was here before, and on a page with no DevTools that is `undefined`.
  // Under `exactOptionalPropertyTypes` a bare `?:` cannot be assigned back what
  // it was read as, which would leave the tap unable to undo itself.
  onCommitFiberRoot?: ((...args: unknown[]) => void) | undefined;
  onPostCommitFiberRoot?: ((...args: unknown[]) => void) | undefined;
  onCommitFiberUnmount?: ((...args: unknown[]) => void) | undefined;
}

/**
 * Attach to React's commit stream, installing a hook if there is not one.
 *
 * Two paths, and they fail differently, which is why the refusal is a value:
 *
 * - **Nothing installed.** A minimal hook is written into `scope`. This is only
 *   correct *before* `react-dom` loads, so it refuses when the document already
 *   holds a React container — the observable proxy for "you are too late" — and
 *   refuses outright when `createHook` is false, which is how a caller that
 *   knows it cannot be first declines to write a hook nobody will read.
 * - **A hook exists.** Its `onCommitFiberRoot` is wrapped, the original still
 *   called first. That covers the DevTools extension and any other harness, and
 *   `stop()` puts the original back rather than deleting the field.
 *
 * FIXME: the Eyes page agent records this stream but stabilization does not ask
 * {@link awaitQuiet} whether the framework has stopped committing. A page whose
 * requests have all settled and whose components are still rendering is still
 * read at whichever commit the raster reaches. The evidence exists in the test
 * chronology; making it a capture refusal remains collector policy.
 */
export function tapCommits(options: TapOptions = {}): CommitTap {
  const scope = options.scope ?? (globalThis as unknown as Record<string, unknown>);
  const nameLimit = options.nameLimit ?? DEFAULT_NAME_LIMIT;
  const updaterLimit = options.updaterLimit ?? DEFAULT_NAME_LIMIT;
  const keep = options.keep ?? DEFAULT_KEEP;
  const refuseIfLoaded = options.refuseIfLoaded ?? true;
  const createHook = options.createHook ?? true;

  const existing = scope[HOOK_KEY] as DevToolsHook | undefined;

  // Ahead of the container scan below, which cannot change the answer: a caller
  // that will not install a hook has nothing to attach to either way.
  if (existing === undefined && !createHook) return refused('no-hook');
  if (existing === undefined && refuseIfLoaded && reactHasMounted(scope)) {
    return refused('react-already-loaded');
  }
  if (existing !== undefined && typeof existing !== 'object') {
    return refused('unrecognised-hook');
  }

  const started = now();
  const recorded: Commit[] = [];
  let lost = 0;
  let last = started;
  let stopped = false;

  const record = (...args: unknown[]): void => {
    if (stopped) return;
    const fiberRoot = args[1] as FiberRootUpdate | undefined;
    last = now();

    const named = fiberRoot?.current ? componentsThatRendered(fiberRoot.current, nameLimit) : null;
    const updaterEvidence = memoizedUpdatersOf(fiberRoot, updaterLimit);
    const commit: {
      at: number;
      components: readonly string[];
      updaters?: readonly CommitUpdater[];
      truncated?: boolean;
      updatersTruncated?: boolean;
    } = {
      at: last - started,
      components: named?.names ?? [],
    };
    if (named?.truncated) commit.truncated = true;
    if (updaterEvidence !== undefined) {
      commit.updaters = updaterEvidence.updaters;
      if (updaterEvidence.truncated) commit.updatersTruncated = true;
    }

    recorded.push(commit);
    if (recorded.length > keep) {
      recorded.shift();
      lost += 1;
    }
    options.onCommit?.(commit);
  };

  const hook: DevToolsHook = existing ?? installHook(scope);
  const previous = hook.onCommitFiberRoot;

  hook.onCommitFiberRoot = (...args: unknown[]): void => {
    // Theirs first, and outside our own try: a harness that throws is a bug we
    // must not swallow, and a bug in *our* recording must not break a page that
    // was working before we arrived.
    previous?.apply(hook, args);
    try {
      record(...args);
    } catch {
      /* A capture is worth more than a commit record. */
    }
  };

  return {
    attached: true,
    get reactVersion(): string | undefined {
      return injectedVersion(hook);
    },
    commits: () => recorded.slice(),
    dropped: () => lost,
    quietFor: () => now() - last,
    stop: () => {
      if (stopped) return;
      stopped = true;
      hook.onCommitFiberRoot = previous;
    },
  };
}

/**
 * Composite components with `PerformedWork` set, in tree order.
 *
 * Pruned by `subtreeFlags`: a subtree that did no work has the bit clear all the
 * way down, so the walk skips it entirely. That is what keeps a per-commit cost
 * proportional to what *changed* rather than to the size of the application — on
 * a page where one clock ticks inside a thousand-component tree, this visits the
 * path to the clock.
 */
function componentsThatRendered(
  root: Fiber,
  limit: number,
): { names: string[]; truncated: boolean } {
  const names: string[] = [];
  const stack: Fiber[] = [root];
  let visited = 0;
  let truncated = false;

  while (stack.length > 0) {
    const fiber = stack.pop();
    if (!fiber) break;
    if ((visited += 1) > MAX_FIBERS) return { names, truncated: true };

    const flags = flagsOf(fiber);
    if ((flags.own & PERFORMED_WORK) !== 0 && isOwnerFrame(fiber)) {
      if (names.length >= limit) {
        truncated = true;
      } else {
        names.push(fiberComponentName(fiber));
      }
    }

    if (fiber.sibling && fiber !== root) stack.push(fiber.sibling);
    // The root is always descended into: its own flags say nothing about a
    // commit, and `subtreeFlags` on it is what carries the answer.
    if (fiber.child && (fiber === root || ((flags.own | flags.subtree) & PERFORMED_WORK) !== 0)) {
      stack.push(fiber.child);
    }
  }

  return { names, truncated };
}

/**
 * Flags, tolerating a fiber shape that does not have them.
 *
 * `flags`/`subtreeFlags` are not on the structural `Fiber` type this package
 * declares, deliberately: they are the most volatile fields React has, and only
 * this module reads them. Absent reads as zero, which makes a renamed field a
 * commit that names nothing rather than a thrown collector.
 */
function flagsOf(fiber: Fiber): { own: number; subtree: number } {
  const record = fiber as unknown as { flags?: unknown; subtreeFlags?: unknown };
  return {
    own: typeof record.flags === 'number' ? record.flags : 0,
    subtree: typeof record.subtreeFlags === 'number' ? record.subtreeFlags : 0,
  };
}

/**
 * The minimum `react-dom` requires of a hook, and nothing more.
 *
 * `inject` must return an id and the `on*` methods must exist, or `react-dom`
 * throws while wiring itself up — which would break the page this is supposed to
 * be observing. `supportsFiber` is what it checks before talking at all.
 */
function installHook(scope: Record<string, unknown>): DevToolsHook {
  const renderers = new Map<number, { version?: string }>();
  let nextId = 1;

  const hook: DevToolsHook = {
    renderers,
    supportsFiber: true,
    inject: (internals: unknown) => {
      const id = nextId++;
      renderers.set(id, (internals as { version?: string }) ?? {});
      return id;
    },
    onCommitFiberRoot: () => {},
    onPostCommitFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
  };

  scope[HOOK_KEY] = hook;
  return hook;
}

function injectedVersion(hook: DevToolsHook): string | undefined {
  const renderers = hook.renderers;
  if (!renderers || typeof renderers.forEach !== 'function') return undefined;

  let version: string | undefined;
  renderers.forEach((renderer) => {
    if (version === undefined && typeof renderer?.version === 'string') version = renderer.version;
  });
  return version;
}

/**
 * Has React already mounted something in this document?
 *
 * The observable proxy for "the hook was installed too late". Structural, like
 * `findReactContainers` — it asks the document rather than trusting a flag
 * somebody set.
 */
function reactHasMounted(scope: Record<string, unknown>): boolean {
  const doc = (scope['document'] ?? globalThis.document) as Document | undefined;
  if (!doc?.querySelectorAll) return false;

  const all = doc.querySelectorAll('*');
  for (let index = 0; index < all.length; index += 1) {
    const element = all[index] as unknown as Record<string, unknown> | undefined;
    if (!element) continue;
    for (const key of Object.keys(element)) {
      if (key.startsWith(CONTAINER_KEY_PREFIX)) return true;
    }
  }
  return false;
}

function refused(reason: TapRefusal): CommitTap {
  return {
    attached: false,
    reason,
    commits: () => [],
    dropped: () => 0,
    quietFor: () => 0,
    stop: () => {},
  };
}

function now(): number {
  const clock = globalThis.performance;
  return clock && typeof clock.now === 'function' ? clock.now() : Date.now();
}
