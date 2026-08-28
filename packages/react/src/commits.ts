import { isOwnerFrame, type Fiber } from './fiber.js';
import { fiberComponentName } from './names.js';

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

  /** Set when `nameLimit` cut the list short. Absent means the list is complete. */
  readonly truncated?: boolean;
}

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
  | 'unrecognised-hook';

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
  readonly keep?: number;
  /**
   * Whether a page that has already mounted React is a refusal.
   *
   * Default true, and it should stay true in a collector. Turn it off only when
   * something else guarantees the hook was installed first and the containers
   * present belong to a root this tap will still hear from — a Storybook iframe
   * that remounts per story is the case that motivates the option.
   */
  readonly refuseIfLoaded?: boolean;
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
 *   holds a React container — the observable proxy for "you are too late".
 * - **A hook exists.** Its `onCommitFiberRoot` is wrapped, the original still
 *   called first. That covers the DevTools extension and any other harness, and
 *   `stop()` puts the original back rather than deleting the field.
 *
 * FIXME: no collector composes this. `awaitSuspense` runs ahead of stabilization
 * in every page agent, but nothing asks {@link awaitQuiet} whether the framework
 * has stopped committing — so a page whose requests have all settled and whose
 * components are still rendering is read at whatever commit the raster lands on.
 * The blocker is the ordering constraint above: a tap must be installed before
 * `react-dom` runs, and a collector's bundle is injected into a page the host
 * already built. `examples/todomvc` is the only caller, and it gets there by
 * owning its own entry. This is the second rung of `stabilization.md`'s ladder,
 * and the one held back by something a collector cannot decide — `gateStability`
 * is the third, and is held back only by what it costs.
 */
export function tapCommits(options: TapOptions = {}): CommitTap {
  const scope = options.scope ?? (globalThis as unknown as Record<string, unknown>);
  const nameLimit = options.nameLimit ?? DEFAULT_NAME_LIMIT;
  const keep = options.keep ?? DEFAULT_KEEP;
  const refuseIfLoaded = options.refuseIfLoaded ?? true;

  const existing = scope[HOOK_KEY] as DevToolsHook | undefined;

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
    const fiberRoot = args[1] as { current?: Fiber } | undefined;
    last = now();

    const named = fiberRoot?.current ? componentsThatRendered(fiberRoot.current, nameLimit) : null;
    const commit: { at: number; components: readonly string[]; truncated?: boolean } = {
      at: last - started,
      components: named?.names ?? [],
    };
    if (named?.truncated) commit.truncated = true;

    recorded.push(commit);
    if (recorded.length > keep) {
      recorded.shift();
      lost += 1;
    }
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

export interface QuietResult {
  /** True when the page went `quietFor` milliseconds without a commit. */
  readonly settled: boolean;
  /** How long the page was quiet for when this returned. */
  readonly quietFor: number;
  /** Commits observed while waiting. */
  readonly commits: number;
  /**
   * Components that rendered while waiting, most commits first.
   *
   * The output that makes an unsettled page actionable. On a page that settles
   * this is what arrived late; on one that never does, it is the thing to fix.
   */
  readonly restless: readonly { readonly name: string; readonly commits: number }[];
}

export interface QuietOptions {
  /** Milliseconds of silence that count as settled. */
  readonly quietFor?: number;
  /** Give up after this long and report what was still moving. */
  readonly timeout?: number;
  /** Poll interval. The tap is event-driven; this only decides how soon we look. */
  readonly interval?: number;
}

/**
 * Wait until React stops committing, and say what was moving if it does not.
 *
 * The honest limits, because this is the function that will be mistaken for a
 * guarantee. It knows about React and nothing else: a CSS animation, an image
 * decoding, a canvas painting itself and a third-party widget with its own
 * renderer all keep a page moving without committing anything. It is a *stronger*
 * signal than two matching screenshots for the movement it covers and a blind
 * one for the rest, which is why it belongs beside the wire and the stylesheet
 * (`docs/stabilization.md`) rather than in place of them.
 *
 * Returns rather than throws on timeout, for the reason `network.settle()` does:
 * a page holding something open is a normal page, and the run wants the reading
 * plus the diagnostic, not an aborted subject.
 */
export async function awaitQuiet(tap: CommitTap, options: QuietOptions = {}): Promise<QuietResult> {
  const quietFor = options.quietFor ?? 100;
  const timeout = options.timeout ?? 2_000;
  const interval = options.interval ?? 16;

  const before = tap.commits().length;
  const deadline = now() + timeout;

  // An unattached tap cannot observe silence, so it must not claim it. Reporting
  // `settled: false` with nothing restless is the shape a caller can tell apart
  // from a page that genuinely never settled.
  if (!tap.attached) {
    return { settled: false, quietFor: 0, commits: 0, restless: [] };
  }

  for (;;) {
    const quiet = tap.quietFor();
    if (quiet >= quietFor) {
      return { settled: true, quietFor: quiet, ...seenSince(tap, before) };
    }
    if (now() >= deadline) {
      return { settled: false, quietFor: quiet, ...seenSince(tap, before) };
    }
    await sleep(Math.min(interval, Math.max(1, quietFor - quiet)));
  }
}

function seenSince(
  tap: CommitTap,
  before: number,
): { commits: number; restless: readonly { name: string; commits: number }[] } {
  const since = tap.commits().slice(before);
  const counts = new Map<string, number>();

  for (const commit of since) {
    for (const name of commit.components) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const restless = [...counts]
    .map(([name, commits]) => ({ name, commits }))
    // Ties broken by name so two runs of one page print the same line.
    .sort(
      (a, b) => b.commits - a.commits || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );

  return { commits: since.length, restless };
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
