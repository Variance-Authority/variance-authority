import { containerFiber, fiberRootOf, findReactContainers } from './fiber.js';

/**
 * Waiting for React to hydrate the document a server rendered, and saying so
 * when it has not.
 *
 * `load` is not a hydration barrier and neither is a quiet network. A
 * server-rendered route arrives complete — every element, every string, the
 * whole subject visibly on screen — and carries no fiber at all until the
 * client bundle creates its root and commits. Measured on a streaming RSC route
 * served in development: the document was complete at 14ms, the root existed at
 * 63ms, and the first host fiber appeared at 96ms. A capture taken anywhere in
 * that window reads a correct document with no React attached to it.
 *
 * What makes that window easy to land in is caching, which is the opposite of
 * what intuition suggests. The first route of a run fetches the whole module
 * graph, so the wire is still busy long after `load` and hydration lands while
 * the driver is waiting on it. Every route after that is served from memory: the
 * wire settles at once, the driver reads immediately, and the read happens
 * before the commit. A machine running several worlds at once widens the same
 * window from the other side: hydration simply finishes later.
 *
 * **The fiber count is not the answer.** React attaches a fiber to a host node
 * when it *completes* the node during render, before anything commits. A shell
 * that suspends — on the RSC payload, a lazy chunk, a promise read outside any
 * `<Suspense>` — leaves the nodes rendered before it carrying fibers while the
 * root stays dehydrated, and the count holds still for as long as the shell
 * does. A wait that took a steady count for a finished commit released the
 * capture there, and every node past the suspension came back with no
 * component.
 *
 * The answer is React's own: a root records whether it has committed, on the
 * state of its current `HostRoot`. So the wait finds the roots that reach the
 * subject and reads that record, and it reports what it read instead of what it
 * hoped. Nothing about a missing component is loud — the document is right, the
 * image is right, the geometry is right — so a capture that could not read one
 * has to say why, or its absence looks exactly like a production build.
 *
 * Dehydrated Suspense boundaries under a hydrated root are not waited for here.
 * `awaitSuspense` reads them as still arriving, and a subject still arriving is
 * refused (ADR-0037).
 */

export interface HydrationWaitOptions {
  /**
   * Give up after this long. Defaults to 2000.
   *
   * `0` reads once and waits for nothing, for a caller that has decided a
   * server-rendered document is the subject.
   */
  readonly timeoutMs?: number;
  /** How often to re-read. Defaults to 16, one frame. */
  readonly pollMs?: number;
}

export type HydrationState =
  /** Every React root that reaches the subject had committed. Components read off it are observed. */
  | 'hydrated'
  /**
   * A root reaches the subject and React had not committed it when the wait
   * ran out: still dehydrated, or created and not yet rendered. The fibers a
   * component is read from are missing or work in progress, so a node with no
   * component here is unobserved, not unattributed.
   */
  | 'hydrating'
  /**
   * No React root reached the subject. Either React does not render it, or its
   * client had not created a root by the time the wait ran out: at the moment
   * of reading those are the same page, and this does not pretend to pick one.
   */
  | 'unrooted';

/**
 * What a wait for React to hydrate the subject found, whether or not it did.
 *
 * Returned rather than thrown on, because a page that never hydrates is a
 * result and not an error. A collector reads `state` to say whether the
 * components it read are observations, and carries the other two answers to
 * the report instead of letting them look like a page that has no components.
 */
export interface HydrationSettlement {
  readonly state: HydrationState;
  /** React roots that reached the subject at the last read. */
  readonly roots: number;
  /** Of those, the ones React had not committed. Zero unless `state` is `hydrating`. */
  readonly pending: number;
  /** How long this actually waited, in milliseconds. */
  readonly waitedMs: number;
}

const DEFAULT_HYDRATION_TIMEOUT_MS = 2_000;
const DEFAULT_POLL_MS = 16;

/**
 * Wait until every React root that reaches `node` has committed, and say what
 * was read if one never does.
 *
 * A root reaches the subject from one of three places, and each is a case a
 * real page produces. Above it: the container of the root it was rendered in,
 * which is the `Document` itself for an app that hydrates the whole page.
 * Below it: a root mounted inside the subject. On it: the fiber of a subject a
 * portal moved out of its root's container.
 */
export async function awaitHydration(
  node: Node,
  options: HydrationWaitOptions = {},
): Promise<HydrationSettlement> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HYDRATION_TIMEOUT_MS;
  const pollMs = Math.max(1, options.pollMs ?? DEFAULT_POLL_MS);
  const started = now();

  for (;;) {
    const roots = rootsReaching(node);
    let pending = 0;
    for (const root of roots) if (!committed(root)) pending += 1;

    const waitedMs = now() - started;
    if (roots.size > 0 && pending === 0) {
      return { state: 'hydrated', roots: roots.size, pending: 0, waitedMs };
    }
    if (waitedMs >= timeoutMs) {
      return { state: roots.size === 0 ? 'unrooted' : 'hydrating', roots: roots.size, pending, waitedMs };
    }

    await sleep(Math.min(pollMs, Math.max(1, timeoutMs - waitedMs)));
  }
}

/** Every `FiberRoot` reaching the subject, once each. */
function rootsReaching(node: Node): Set<object> {
  const found = new Set<object>();
  const add = (root: unknown): void => {
    if (typeof root === 'object' && root !== null) found.add(root);
  };

  // The subject itself and every ancestor, up to and including the Document,
  // which `querySelectorAll` can never return.
  for (let at: Node | null = node; at !== null; at = parentOf(at)) {
    add(containerFiber(at)?.stateNode);
  }

  const scope = node as Node & Partial<ParentNode>;
  if (typeof scope.querySelectorAll === 'function') {
    for (const container of findReactContainers(scope as ParentNode)) {
      add(containerFiber(container)?.stateNode);
    }
  }

  add(fiberRootOf(node));
  return found;
}

/** Up the tree, crossing out of a shadow root to its host. */
function parentOf(node: Node): Node | null {
  if (node.parentNode !== null) return node.parentNode;
  const host = (node as Partial<ShadowRoot>).host;
  return host ?? null;
}

/**
 * Whether React has committed this root, read off its current `HostRoot`.
 *
 * INTERNAL CONTRACT: `HostRoot.memoizedState` is `{ element, isDehydrated, … }`
 * in React 18 and 19. `hydrateRoot` starts it with `isDehydrated: true` and the
 * hydration commit replaces it; `createRoot` starts it with `element: null` and
 * the first commit puts the rendered element there. React 17's legacy
 * `hydrate` and `render` commit synchronously, so a reader never sees them
 * mid-flight. If React renames either field, the symptom is a subject that
 * reads `hydrating` until the budget runs out on every page — loud, and named
 * in every report, rather than quiet.
 */
function committed(root: object): boolean {
  const current = (root as { readonly current?: { readonly memoizedState?: unknown } | null }).current;
  const state = current?.memoizedState as
    | { readonly element?: unknown; readonly isDehydrated?: unknown }
    | null
    | undefined;
  if (state === null || state === undefined) return false;
  if (state.isDehydrated === true) return false;
  return state.element !== null && state.element !== undefined;
}

function now(): number {
  const clock = globalThis.performance;
  return clock && typeof clock.now === 'function' ? clock.now() : Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
