import { hasFiber } from './fiber.js';

/**
 * Waiting for React to commit into a document that was rendered on the server.
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
 * before the commit. So the subject that attributes cleanly is the first one,
 * and the failure arrives on subject two and stays — which reads as a property
 * of those pages rather than of the order they were visited in.
 *
 * Nothing about that is loud. The document is right, the image is right, the
 * geometry is right; the only casualty is provenance, and its absence looks
 * exactly like a production build with no development metadata. That is the
 * failure this exists to close, and closing it is a wait rather than a
 * detection: at the moment the driver looks, a page that has not started
 * hydrating and a page that never will are the same page.
 *
 * So the wait is bounded and the budget is the whole of the cost. A page with no
 * client React pays it once per subject and is then read exactly as before —
 * which is why the caller only runs this when the run has already declared it
 * expects to read fibers.
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
  /**
   * Consecutive reads at an unchanged fiber count before the document counts as
   * hydrated. Defaults to 2.
   *
   * The same guard `awaitSuspense` keeps, against the same shape of mistake.
   * Hydration is not one commit: React attaches the root, commits part of the
   * tree, and commits the rest as the streamed payload and the lazy chunks
   * arrive. A barrier that returned on the first fiber it saw would release the
   * capture into the middle of that — which is not a failure, it is worse. It
   * is a subject read with two hundred of its nodes attributed and eight hundred
   * not, where the missing ones look like components that were never written in
   * a way this tool can see. Measured on two routes of one site, released on
   * first sight: 63 and 94 nodes carried provenance where a settled read of the
   * same pages carried 870 and 1693.
   */
  readonly confirmations?: number;
}

/** The last observed fiber count and whether it reached the requested stability. */
export interface HydrationSettlement {
  /** True when the fiber count at or under the root came to rest above zero. */
  readonly hydrated: boolean;
  /** Nodes carrying a fiber at the last read. */
  readonly fibers: number;
  /** How long this actually waited, in milliseconds. */
  readonly waitedMs: number;
}

const DEFAULT_HYDRATION_TIMEOUT_MS = 2_000;
const DEFAULT_POLL_MS = 16;
const DEFAULT_CONFIRMATIONS = 2;

/**
 * Wait until React has committed at or under `node`, and say whether it did.
 *
 * Returns rather than throws, and a `false` is a legitimate answer rather than a
 * failure: a route table may hold a page this project's adapter was never going
 * to read. The caller decides what that means — here it means the capture goes
 * ahead with no provenance, which is what it did before this wait existed.
 */
export async function awaitHydration(
  node: Node,
  options: HydrationWaitOptions = {},
): Promise<HydrationSettlement> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HYDRATION_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const confirmations = options.confirmations ?? DEFAULT_CONFIRMATIONS;
  const started = now();

  let last = -1;
  let steady = 0;

  for (;;) {
    const fibers = fiberCount(node);

    // Zero never confirms. A document React has not reached yet holds still at
    // zero for as long as anybody watches it, and a barrier that let a steady
    // count through without asking whether the count was anything would report
    // every static page as hydrated the moment it was read twice.
    if (fibers > 0 && fibers === last) {
      steady += 1;
      if (steady >= confirmations) return { hydrated: true, waitedMs: now() - started, fibers };
    } else {
      steady = fibers > 0 ? 1 : 0;
    }
    last = fibers;

    const waited = now() - started;
    if (waited >= timeoutMs) return { hydrated: fibers > 0, waitedMs: waited, fibers };

    await sleep(Math.min(pollMs, Math.max(1, timeoutMs - waited)));
  }
}

/**
 * How many nodes at or under this one React has committed into.
 *
 * Counted rather than sought, because the question is whether hydration has
 * finished and not whether it has started — and the only evidence of finishing
 * available from outside React is that the number stopped moving. The whole
 * subtree is visited on every poll, which is what the budget is really buying:
 * an expando read per element, measured in tens of microseconds over a
 * thousand-element route, against a navigation that costs tens of milliseconds.
 */
function fiberCount(node: Node): number {
  let found = hasFiber(node) ? 1 : 0;

  const scope = node as Node & Partial<ParentNode>;
  if (typeof scope.querySelectorAll !== 'function') return found;

  const all = scope.querySelectorAll('*');
  for (let index = 0; index < all.length; index += 1) {
    const element = all[index];
    if (element !== undefined && hasFiber(element)) found += 1;
  }
  return found;
}

function now(): number {
  const clock = globalThis.performance;
  return clock && typeof clock.now === 'function' ? clock.now() : Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
