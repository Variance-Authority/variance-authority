import {
  FiberTag,
  currentFiber,
  findFiber,
  findReactContainers,
  hasFiber,
  isOwnerFrame,
  type Fiber,
} from './fiber.js';
import { debugOwnerName, fiberComponentName } from './names.js';

/**
 * Suspense boundaries, and which of them were showing a fallback when read.
 *
 * The class of variance this exists for is the one every visual-regression tool
 * meets and none of them names. Content that arrives late is not noise — it is a
 * structural difference, and correctly so (`docs/flakiness.md`). The question a
 * red build actually needs answered is *were we still waiting when we looked*,
 * and every existing answer to it is a timing heuristic: poll the DOM, poll the
 * wire, take the picture twice and hope.
 *
 * A React application already holds the answer as a value. `<Suspense>` is a
 * boundary somebody authored, at a place in the tree, with a name above it — so
 * "the page had not finished" can be reported as *this boundary, held by this
 * component, was showing its fallback*, which is a sentence a fix can be aimed
 * at rather than a threshold somebody has to tune.
 *
 * Read by traversal, with nothing installed. That is the constraint the whole
 * package is under (see `fiber.ts`): the DevTools hook is a browser extension or
 * an opted-in harness, and neither exists in a bare Playwright context. A
 * boundary's state is a field on a committed fiber, so a walk after the fact
 * sees it — which also means this works on a page nobody prepared, including one
 * this project did not mount.
 */

/**
 * The `SuspenseState` React stores on a suspended boundary.
 *
 * INTERNAL CONTRACT — the load-bearing one in this file. On a
 * `SuspenseComponent` fiber, `memoizedState` is `null` when the boundary is
 * showing its children and a `SuspenseState` object when it is showing its
 * fallback. Verified on React 19.2.8: a boundary awaiting a promise carries
 * `{dehydrated, treeContext, retryLane, hydrationErrors}` and reads `null` again
 * once the promise resolves, with the sibling `OffscreenComponent` (tag 22)
 * flipping its own `memoizedState` the same way.
 *
 * If React changes the convention, the symptom is a boundary reported
 * `resolved` while it is showing a fallback — which since ADR-0037 is a subject
 * captured mid-arrival rather than merely a lost diagnostic. The
 * corroborating read of the Offscreen child exists so that the two would have to
 * change together for that to happen quietly.
 */
interface SuspenseState {
  /**
   * Present and non-null only for a boundary that has server markup it has not
   * hydrated yet. That is a different problem from a pending promise — nobody
   * fixes it by awaiting data — so it is reported as a different state rather
   * than folded into `pending`.
   */
  readonly dehydrated?: unknown;
}

export type SuspenseStateName =
  /** Showing its children. Whatever it was waiting for has arrived. */
  | 'resolved'
  /** Showing its fallback, waiting on something the application asked for. */
  | 'pending'
  /** Showing server markup React has not hydrated. Not a data wait. */
  | 'dehydrated';

export interface SuspenseBoundary {
  readonly state: SuspenseStateName;

  /**
   * Composite components enclosing the boundary, innermost first.
   *
   * This is what names it. A `<Suspense>` element has no `type` to read — React
   * leaves `type` null on the fiber and carries the brand on `elementType` — so
   * a boundary has no name of its own and never will. What it has is the code it
   * sits inside, which is the thing a reader opens.
   */
  readonly owners: readonly string[];

  /**
   * The component whose JSX wrote this `<Suspense>`.
   *
   * Development-only, like every `_debugOwner` read in this package. On a
   * production build the field is absent, and absent is not "nobody wrote it".
   */
  readonly createdBy?: string;

  /** The element's `key`, when the author gave it one. */
  readonly key?: string;

  /**
   * How many boundaries enclose this one.
   *
   * A nested boundary that is pending *because its parent is* is not a second
   * finding, and the depth is what lets a reader collapse the pair without the
   * two being merged here — merging them would need a rule about which one is
   * the cause, which is exactly the judgement this module refuses to make.
   */
  readonly depth: number;
}

/** A `return` chain longer than this is cyclic, not deep. Mirrors `fiber.ts`. */
const MAX_WALK_DEPTH = 10_000;

/**
 * Runaway guard on the downward walk, in fibers rather than depth.
 *
 * Deliberately far above any real tree — a large application is tens of
 * thousands of fibers, and a limit set near that would silently stop reporting
 * boundaries on exactly the pages that have the most of them. What it catches is
 * a cyclic `child`/`sibling` graph, which would otherwise hang the collector
 * inside somebody else's page.
 */
const MAX_FIBERS = 500_000;

/** Written onto the element passed to `createRoot`/`render`. */
const CONTAINER_KEY_PREFIX = '__reactContainer$';

/**
 * Every Suspense boundary in the subtree a DOM node roots.
 *
 * Scoped to a node rather than the page, because a verdict is about a subject.
 * A Storybook page holds one story and a decorator's chrome; a route holds the
 * whole application. Reporting the page's boundaries against a subject would
 * attribute somebody else's spinner to this component — the same mistake the
 * asset narrowing exists to prevent (`docs/stabilization.md`).
 *
 * Returns an empty list both for a subtree with no boundaries and for a node
 * React never rendered. Those are different facts; `hasFiber` is how a caller
 * that needs to tell them apart does it, and the collector records the second as
 * a diagnostic rather than as "no boundaries".
 */
export function suspenseBoundariesIn(node: Node): readonly SuspenseBoundary[] {
  return boundariesUnder(node) ?? [];
}

/**
 * Boundaries under a node, or `null` when there was no React there to read.
 *
 * The distinction the exported pair cannot make and `awaitSuspense` needs: an
 * empty list means *read, and nothing is waiting*, and `null` means *nobody
 * looked*. Reporting the second as the first would let a page with no React on
 * it — a failed bundle, a wrong root, a framework this package does not know —
 * report itself as fully settled, which is ADR-0002's absent-never-zeroed rule
 * applied to a wait rather than to a band.
 *
 * Three ways in, because a subject root is one of three things and only one of
 * them was covered by reading the node's own fiber:
 *
 * 1. **React made it.** The expando is on the node; walk from there.
 * 2. **It *is* a root container.** `createRoot(element)` writes
 *    `__reactContainer$…`, not `__reactFiber$…`, so a Storybook run reading
 *    `#storybook-root` had no fiber to find and every story looked boundary-free.
 * 3. **It contains roots.** A route run's subject is `body`, which React never
 *    touched and which holds whatever the application mounted into.
 *
 * Exported to `arrival.ts` and not from the package: the wait needs the `null`,
 * because "no React here" and "React here, nothing waiting" are different
 * outcomes, and `suspenseBoundariesIn` has already flattened them to `[]`.
 */
export function boundariesUnder(node: Node): readonly SuspenseBoundary[] | null {
  let own: Fiber | null = null;
  try {
    if (hasFiber(node)) own = findFiber(node);
  } catch {
    return null;
  }

  if (own !== null) {
    const found: SuspenseBoundary[] = [];
    // The node's own fiber is the root of this walk, so its siblings are outside
    // the subtree and are not visited: a subject's neighbours are not the subject.
    collectFrom(own, found);
    return found;
  }

  const scope = node as Node & Partial<ParentNode>;
  if (typeof scope.querySelectorAll !== 'function') return null;

  const roots: Fiber[] = [];
  // The node itself first, and `querySelectorAll` never returns it — which is
  // exactly how case 2 above went missing.
  if (node.nodeType === 1) {
    const here = containerFiber(node as Element);
    if (here !== null) roots.push(here);
  }
  for (const container of findReactContainers(node as ParentNode)) {
    const fiber = containerFiber(container);
    if (fiber !== null) roots.push(fiber);
  }

  if (roots.length === 0) return null;

  const found: SuspenseBoundary[] = [];
  for (const root of roots) collectFrom(root, found);
  return found;
}

/**
 * Every Suspense boundary under every React root in `scope`.
 *
 * The page-wide read, for the case where there is no subject yet — a driver
 * deciding whether the application has finished arriving before it starts
 * collecting anything. Finds roots structurally, so it needs no cooperation from
 * the application and no hook.
 */
export function suspenseBoundaries(scope: ParentNode): readonly SuspenseBoundary[] {
  const found: SuspenseBoundary[] = [];
  const all = scope.querySelectorAll('*');

  for (let index = 0; index < all.length; index += 1) {
    const element = all[index];
    if (!element) continue;
    const root = containerFiber(element);
    if (root === null) continue;
    collectFrom(root, found);
  }

  return found;
}

/**
 * Boundaries that were not showing their children, in tree order.
 *
 * The one most callers want: a non-empty answer means the subject was read
 * mid-arrival, and the list says where. `dehydrated` is included because it is
 * equally a page that is not finished — the fix differs, and the state field is
 * what carries that.
 */
export function pendingSuspense(node: Node): readonly SuspenseBoundary[] {
  return suspenseBoundariesIn(node).filter((boundary) => boundary.state !== 'resolved');
}

/**
 * The HostRoot fiber React cached on a container element, resolved to current.
 *
 * `markContainerAsRoot` writes the fiber once, at mount, and never re-points it
 * — the same double-buffering hazard `currentFiber` documents for host nodes. An
 * unresolved read here would walk the *stale* tree, where a boundary's
 * `memoizedState` is one commit behind, and report a spinner that has already
 * gone away.
 */
function containerFiber(element: Element): Fiber | null {
  const record = element as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!key.startsWith(CONTAINER_KEY_PREFIX)) continue;
    const fiber = record[key] as Fiber | null | undefined;
    if (!fiber) return null;
    try {
      return currentFiber(fiber);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Depth-first walk collecting boundaries, iterative and bounded.
 *
 * Iterative because this runs inside somebody else's page on a tree whose depth
 * nobody here chose, and a recursive walk that blows the stack takes the capture
 * with it. Bounded for the reason `fiber.ts` bounds its walks: a cyclic `child`
 * chain must fail the read, not hang the collector.
 */
function collectFrom(root: Fiber, into: SuspenseBoundary[]): void {
  const stack: { fiber: Fiber; boundaries: number }[] = [{ fiber: root, boundaries: 0 }];
  let visited = 0;

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    if ((visited += 1) > MAX_FIBERS) return;

    const { fiber } = entry;
    let { boundaries } = entry;

    if (fiber.tag === FiberTag.SuspenseComponent) {
      into.push(describe(fiber, boundaries));
      boundaries += 1;
    }

    // The root's own siblings belong to whatever encloses it, so they are not
    // followed. Every fiber below the root is inside the subtree, and its
    // siblings are too.
    if (fiber.sibling && fiber !== root) {
      stack.push({ fiber: fiber.sibling, boundaries: entry.boundaries });
    }
    if (fiber.child) stack.push({ fiber: fiber.child, boundaries });
  }
}

function describe(fiber: Fiber, depth: number): SuspenseBoundary {
  const state = stateOf(fiber);
  const createdBy = debugOwnerName(fiber._debugOwner);

  const boundary: {
    state: SuspenseStateName;
    owners: readonly string[];
    createdBy?: string;
    key?: string;
    depth: number;
  } = { state, owners: ownersAbove(fiber), depth };

  if (createdBy !== null) boundary.createdBy = createdBy;
  if (fiber.key !== null) boundary.key = fiber.key;

  return boundary;
}

/**
 * Which of the three states this boundary is in.
 *
 * Reads the boundary's own `memoizedState` and does *not* fall back to the
 * Offscreen child when that field is a shape we do not recognise. A guess here
 * would produce the one output this file must not produce: a confident
 * `pending` naming a component that is fine, sending somebody to fix a spinner
 * that was never on screen.
 */
function stateOf(fiber: Fiber): SuspenseStateName {
  const state = fiber.memoizedState as SuspenseState | null | undefined;
  if (state === null || state === undefined) return 'resolved';
  if (typeof state !== 'object') return 'resolved';
  return state.dehydrated != null ? 'dehydrated' : 'pending';
}

/**
 * Composite components enclosing the boundary, innermost first.
 *
 * Unlike `resolveProvenance`'s chain this carries names only. A boundary has no
 * props of its own worth digesting — `fallback` and `children` are both elements
 * — so a props digest here would be a field nobody could act on.
 */
function ownersAbove(fiber: Fiber): readonly string[] {
  const names: string[] = [];
  let node: Fiber | null = fiber.return;

  for (let depth = 0; node !== null && depth < MAX_WALK_DEPTH; depth += 1) {
    if (node.tag === FiberTag.HostRoot) break;
    if (isOwnerFrame(node)) names.push(fiberComponentName(node));
    node = node.return;
  }

  return names;
}
