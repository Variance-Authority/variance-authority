/**
 * Access to React's fiber tree from a DOM node.
 *
 * Everything below reads React internals. None of it is public API: the expando
 * key format, the `tag` numbering, and the field names can change in any React
 * release, including a patch. Each assumption is marked INTERNAL CONTRACT with
 * the symptom its breakage produces, because the dangerous failure here is not
 * an exception — it is a chain that silently gets *shorter* and an attribution
 * that quietly points at the wrong component.
 *
 * The one thing this file deliberately does not do is depend on the React
 * DevTools global hook. The hook is installed by a browser extension or by a
 * test harness that opted in; neither is true in a plain `vitest` run or a
 * headless Playwright page. Provenance has to work at the cheapest tier
 * (ADR-0002) with nothing installed, so the primary path is the expando that
 * `react-dom` itself writes onto every host node it creates.
 */

/**
 * The subset of a fiber this package reads.
 *
 * Deliberately structural rather than imported from `@types/react-reconciler`:
 * a nominal dependency on a types package that tracks one reconciler version
 * would turn a React upgrade into a compile error in a package whose entire job
 * is to survive React upgrades at runtime.
 */
export interface Fiber {
  readonly tag: number;
  readonly key: string | null;
  /** The unresolved type as authored: for `memo(X)` this is the memo object. */
  readonly elementType: unknown;
  /** The resolved type React renders. Differs from `elementType` for wrappers. */
  readonly type: unknown;
  /** Host instance for host fibers; the `FiberRoot` for `HostRoot`. */
  readonly stateNode: unknown;
  readonly return: Fiber | null;
  readonly child: Fiber | null;
  readonly sibling: Fiber | null;
  readonly alternate: Fiber | null;
  readonly memoizedProps: Readonly<Record<string, unknown>> | null;

  /**
   * Per-tag state, and `unknown` because every tag means something different by
   * it: a hook list on a function component, a `SuspenseState` or `null` on a
   * Suspense boundary, an update queue on a class. Only `suspense.ts` reads it,
   * and only after checking the tag — narrowing it here would be a claim about
   * every other tag that nothing has measured.
   */
  readonly memoizedState?: unknown;

  /**
   * Contexts this fiber subscribes to, as a linked list off `firstContext`.
   *
   * Written by `readContext` during render, so it is populated by `useContext`
   * and by a class `contextType` alike, and it is the *only* record of the
   * subscription — `useContext` leaves no entry in the hook chain at all
   * (measured on 19.2.8). A component's context dependencies are therefore
   * unreadable from `memoizedState` and readable only here.
   *
   * INTERNAL CONTRACT: if React renames `firstContext` or stops populating it,
   * the symptom is a `Wiring.contexts` that is silently empty — a component that
   * subscribes to three contexts compares equal to one that subscribes to none.
   * `wiring.test.tsx` asserts a known subscription by name for exactly this.
   */
  readonly dependencies?: { readonly firstContext?: ContextDependency | null } | null;

  /**
   * Development-only. Hook names in call order, exactly as React recorded them
   * while rendering: `['useState', 'useRef', 'useEffect']`.
   *
   * React writes this itself, which is worth stating because the alternative is
   * strictly worse. Walking the `memoizedState` hook chain and inferring names
   * from cell shape cannot separate `useMemo` from `useCallback` (identical
   * `[value, deps]` cells) or `useEffect` from `useLayoutEffect` (identical
   * effect objects, distinguished only by a numeric `tag` whose values are
   * themselves unversioned internals). Both measured on 19.2.8.
   *
   * Absent in production builds. Absent, and the band drops the field rather
   * than substituting `[]` — see {@link Wiring.hooks}.
   */
  readonly _debugHookTypes?: readonly string[] | null;

  /**
   * Development-only. Present on fibers created from JSX in a dev build and
   * absent entirely in production, which is why every read of it is optional.
   * React 19 widened the type: it is a `Fiber` for a client component and a
   * `ReactComponentInfo` (`{ name, env, ... }`, no `tag`) for a server one.
   */
  readonly _debugOwner?: Fiber | DebugComponentInfo | null;

  /**
   * Development-only, and **gone in React 19** — not renamed, dropped. The
   * transform still computes the location and still passes it; React 19's
   * `jsxDEV` takes four parameters and overwrites the fifth with an `Error` of
   * its own. Populated from `element._source` on React ≤18.
   *
   * Its replacement is not a field on the fiber but a runtime in front of
   * React's: `@variance-authority/jsx-source` records the same location on the
   * props object, which arrives here as `memoizedProps`. `resolve.ts` reads that
   * first and this second.
   */
  readonly _debugSource?: DebugSource | null;
}

/** One link of the context-dependency list. `displayName` is set by the author. */
export interface ContextDependency {
  readonly context?: { readonly displayName?: string } | null;
  readonly next?: ContextDependency | null;
}

/** React 19's server-component owner record. Has a `name`, but no `tag`. */
export interface DebugComponentInfo {
  readonly name?: string;
  readonly env?: string;
}

export interface DebugSource {
  readonly fileName?: string;
  readonly lineNumber?: number;
  readonly columnNumber?: number;
}

/**
 * Fiber work tags (`ReactWorkTags.js`).
 *
 * INTERNAL CONTRACT: these numbers are assigned by declaration order in React's
 * source and have been stable for the tags below since React 16. They are not
 * versioned or exported. If React renumbers them, the symptom is an owner chain
 * that loses frames (a tag we no longer recognise as composite) or gains
 * nonsense ones (a Fragment read as a component). The traversal is written so an
 * *unknown* tag is skipped rather than throwing, which makes a renumbering
 * degrade into missing frames instead of a crashed collector — a snapshot with a
 * short chain is recoverable, a collector that throws mid-capture is not.
 */
export const FiberTag = {
  FunctionComponent: 0,
  ClassComponent: 1,
  /**
   * Removed in React 19; a hole in the numbering there rather than a reuse.
   * In React ≤18 it is the mount-time tag of a component whose return value has
   * not been observed yet, and it is rewritten to 0 or 1 before commit — so it
   * should never be seen by a post-commit walk. Recognised anyway: costs
   * nothing, and covers a concurrent read mid-render.
   */
  IndeterminateComponent: 2,
  HostRoot: 3,
  HostPortal: 4,
  HostComponent: 5,
  HostText: 6,
  Fragment: 7,
  Mode: 8,
  ContextConsumer: 9,
  ContextProvider: 10,
  ForwardRef: 11,
  Profiler: 12,
  SuspenseComponent: 13,
  /** `memo(X)` where X is *not* a plain function: an extra wrapper fiber. */
  MemoComponent: 14,
  /** `memo(fn)` where fn is a plain function: the component fiber itself. */
  SimpleMemoComponent: 15,
  LazyComponent: 16,
  IncompleteClassComponent: 17,
  DehydratedFragment: 18,
  SuspenseListComponent: 19,
  ScopeComponent: 21,
  OffscreenComponent: 22,
  LegacyHiddenComponent: 23,
  CacheComponent: 24,
  TracingMarkerComponent: 25,
  HostHoistable: 26,
  HostSingleton: 27,
  IncompleteFunctionComponent: 28,
  Throw: 29,
} as const;

/**
 * Tags that denote a composite component — a boundary someone authored, named,
 * and can be held responsible for. Host elements, fragments, providers, and
 * offscreen wrappers are excluded: nobody adjudicates a `<div>` (spec §6.1).
 *
 * `MemoComponent` (14) is *not* here, and that omission is load-bearing — see
 * `isOwnerFrame` for why.
 *
 * The `Incomplete*` tags appear only while an error boundary is unwinding. They
 * are included so that a snapshot taken of an error state still attributes to
 * the component that failed rather than reporting an empty chain.
 */
const COMPOSITE_TAGS: ReadonlySet<number> = new Set([
  FiberTag.FunctionComponent,
  FiberTag.ClassComponent,
  FiberTag.IndeterminateComponent,
  FiberTag.ForwardRef,
  FiberTag.SimpleMemoComponent,
  FiberTag.IncompleteClassComponent,
  FiberTag.IncompleteFunctionComponent,
]);

/**
 * Should this fiber contribute a frame to the owner chain?
 *
 * The subtle case is `MemoComponent` (tag 14). React chooses between two
 * representations for `memo()`:
 *
 * - `memo(fn)` with a plain function and no custom comparator collapses to a
 *   single `SimpleMemoComponent` (15) fiber whose `type` *is* `fn`;
 * - `memo(fn, compare)` or `memo(forwardRef(fn))` cannot collapse, so React
 *   emits a `MemoComponent` (14) wrapper fiber **plus** a child fiber for the
 *   inner component, both carrying the same props.
 *
 * Verified on React 19.2.8: `memo(forwardRef(f))` yields `14 → 11`, and
 * `memo(f, compare)` yields `14 → 0`. Counting the wrapper would put the same
 * component in the chain twice with an identical props digest, which is not a
 * boundary anyone authored and would make `owners[0]` mean different things
 * depending on whether the author passed a comparator. So the wrapper is
 * dropped and the inner fiber carries the frame.
 *
 * INTERNAL CONTRACT: if React ever emits a `MemoComponent` fiber with no inner
 * component fiber beneath it, the symptom is a missing frame for that
 * component — not a crash, and not a wrong name for anything else.
 */
export function isOwnerFrame(fiber: Fiber): boolean {
  return COMPOSITE_TAGS.has(fiber.tag);
}

/**
 * Guards every `return`/`child` walk.
 *
 * A fiber tree deeper than this is not a real tree; it is a corrupted or cyclic
 * `return` chain, which would otherwise hang the collector rather than fail it.
 */
const MAX_FIBER_DEPTH = 10_000;

/**
 * Expando prefixes `react-dom` writes onto host nodes.
 *
 * INTERNAL CONTRACT: the suffix is `Math.random().toString(36).slice(2)`,
 * regenerated per `react-dom` module instance, so it cannot be hardcoded and
 * two copies of React on one page have two different suffixes. The prefixes
 * themselves are stable: `__reactFiber$` since React 17, `__reactInternalInstance$`
 * in React 16. If React renames them, every element reports no fiber and the
 * collector emits the `no-client-fiber` sentinel for the whole tree — loud and
 * obvious, which is the intended shape of this particular failure.
 */
const FIBER_KEY_PREFIXES = ['__reactFiber$', '__reactInternalInstance$'] as const;

/** Written onto the element passed to `createRoot`/`render`. */
const CONTAINER_KEY_PREFIX = '__reactContainer$';

/**
 * Last successfully used expando key.
 *
 * Purely an optimisation for the common case of one React instance per page.
 * Every lookup falls back to a full scan when the cached key misses, so a page
 * with two React copies stays correct — just slower.
 */
let cachedFiberKey: string | null = null;

function scanForKey(node: object, prefixes: readonly string[]): string | null {
  // React assigns these with a plain `node[key] = value`, so they are own and
  // enumerable. If that ever becomes a non-enumerable define, this returns null
  // and the caller reports no fiber.
  for (const key of Object.keys(node)) {
    for (const prefix of prefixes) {
      if (key.startsWith(prefix)) return key;
    }
  }
  return null;
}

/** The fiber `react-dom` cached on this node, without resolving staleness. */
function rawFiber(node: object): Fiber | null {
  if (cachedFiberKey !== null) {
    const hit = (node as Record<string, unknown>)[cachedFiberKey];
    if (hit) return hit as Fiber;
  }

  const key = scanForKey(node, FIBER_KEY_PREFIXES);
  if (key === null) return null;

  cachedFiberKey = key;
  return ((node as Record<string, unknown>)[key] as Fiber | undefined) ?? null;
}

/**
 * Resolve a fiber to the one in the *current* (committed) tree.
 *
 * This is the single most surprising thing about reading fibers off the DOM, and
 * omitting it produces wrong answers rather than missing ones.
 *
 * React double-buffers: every fiber has an `alternate`, and a commit swaps which
 * of the pair is "current". The expando on a DOM node is written **once, at
 * mount** (`precacheFiberNode`) and is never re-pointed on update. So after an
 * odd number of commits the cached pointer addresses the *stale* tree, and its
 * `memoizedProps` are one render behind.
 *
 * Measured on React 19.2.8 with a prop changing `c1 → c2 → c3`: the cached
 * fiber read `c1` after the second commit and `c3` after the third, while the
 * live DOM showed `c2` and `c3`. Un-resolved, a props digest would flap between
 * "correct" and "one render stale" on alternating renders — which in this
 * system means the root/collateral split of §6.2 would be decided from props
 * that were never actually in force.
 *
 * The test for currentness is the standard one: walk to the top of whichever
 * tree this fiber is in and ask the `FiberRoot` whether that top is `current`.
 */
export function currentFiber(fiber: Fiber): Fiber | null {
  const root = rootOf(fiber);
  if (root === null) return null;

  const fiberRoot = root.stateNode as { current?: Fiber } | null | undefined;
  // Shape we do not recognise: prefer possibly-stale data over no data, since a
  // one-render-old props digest still names the right component.
  if (!fiberRoot || !fiberRoot.current) return fiber;

  if (fiberRoot.current === root) return fiber;

  // A subtree that bailed out is shared by reference between both trees and has
  // no alternate; it is already current despite the walk landing on the other
  // root, so falling back to `fiber` is correct rather than a fudge.
  return fiber.alternate ?? fiber;
}

/** Top of the tree containing `fiber`, or null if it is not attached to a root. */
function rootOf(fiber: Fiber): Fiber | null {
  let node: Fiber = fiber;
  for (let depth = 0; depth < MAX_FIBER_DEPTH; depth += 1) {
    if (node.return === null) return node.tag === FiberTag.HostRoot ? node : null;
    node = node.return;
  }
  return null;
}

/**
 * The committed fiber for a DOM node, or null if React never touched it.
 *
 * Note what "never touched it" covers after an unmount: React 19 *deletes* the
 * expando keys on unmount (verified), so a detached node returns null here
 * rather than handing back a fiber into a dead tree.
 */
export function findFiber(node: Node): Fiber | null {
  const raw = rawFiber(node as unknown as object);
  if (raw === null) return null;
  return currentFiber(raw);
}

/** True when the node was rendered by React, regardless of tree liveness. */
export function hasFiber(node: Node): boolean {
  return rawFiber(node as unknown as object) !== null;
}

/**
 * Container elements React mounted a root into, found structurally.
 *
 * The secondary root-enumeration path (requirement: the DevTools hook must
 * never be a precondition). Scanning for `__reactContainer$` finds every root in
 * a document with no hook and no cooperation from the app — which is what a
 * Storybook iframe or an arbitrary page under Playwright looks like.
 */
export function findReactContainers(scope: ParentNode): Element[] {
  const found: Element[] = [];
  const all = scope.querySelectorAll('*');
  for (let index = 0; index < all.length; index += 1) {
    const element = all[index];
    if (element && scanForKey(element as unknown as object, [CONTAINER_KEY_PREFIX]) !== null) {
      found.push(element);
    }
  }
  return found;
}

/** Reset the memoised expando key. Only needed when a page swaps React copies. */
export function resetFiberKeyCache(): void {
  cachedFiberKey = null;
}
