import type { CommitTap } from './commits.js';
import { containerFiber, fiberRootOf, findReactContainers } from './fiber.js';
import { restlessIn } from './quiet.js';
import { rootCommitted, rootHasWork } from './root-state.js';

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
 * **A wait needs a reason, and ends on one.** No clock decides either. A
 * committed root is read at once. A page React never loaded on is read at once
 * too, when a commit tap installed before the page's scripts can say so: no
 * renderer introduced itself, so no root is coming. A root React has work for —
 * a lane it can render, effects it has not run — is waited for as long as React
 * works, because React will move on its own. A root React can do nothing for —
 * suspended on a promise nothing has pinged, created and never rendered — and a
 * subject no root reaches yet, move only when something outside React answers:
 * a chunk, a payload, a response. Those are waited for while the caller says
 * something the page asked for is still arriving, and read the moment nothing
 * is, with the reason on the settlement. A budget would answer the same
 * question with a guess: too short and a slow machine is refused, too long and
 * every page that will never hydrate pays it in full.
 *
 * **A wait is compared**, given the tap. When the subject had to be waited for,
 * its markup is read before the wait and again once React has run the effects
 * hydration scheduled and rendered whatever they asked for: the tap is what
 * says the effects ran, and a comparison made without it would read the page
 * before they had. A client that rewrites what the server sent — a mounted
 * flag, a theme read from storage — renders the same markup on both sides of
 * hydration, so React reports no mismatch; the visitor still sees one page and
 * then another. The settlement carries both sides of the first difference, and
 * the components that committed after hydration.
 *
 * Dehydrated Suspense boundaries under a hydrated root are not waited for here.
 * `awaitSuspense` reads them as still arriving, and a subject still arriving is
 * refused (ADR-0037).
 */

export interface HydrationWaitOptions {
  /** How often to re-read while React is working. Defaults to 16, one frame. */
  readonly pollMs?: number;
  /**
   * React's commit stream, tapped before the page's scripts ran.
   *
   * What lets the wait tell a page React will hydrate from one React never
   * loaded on, what says the effects of a commit have run, and so what lets the
   * comparison after a wait read the page once they have. Without one, or with
   * one that did not attach, the wait reads no further than React's roots.
   */
  readonly tap?: CommitTap;
  /**
   * Wait for the next thing the page asked for to arrive, and for the page to
   * run what it queued: `true` once something did, `false` at once when nothing
   * is outstanding.
   *
   * Asked only when React cannot move on its own: a root suspended on a promise
   * with nothing pinged, a root created and never rendered, or no root yet.
   * Whatever settles any of those arrives from outside React, and this is the
   * caller saying whether anything still is. Without it, such a subject is read
   * as it stands.
   */
  readonly outstanding?: () => Promise<boolean>;
}

export type HydrationState =
  /** Every React root that reaches the subject had committed. Components read off it are observed. */
  | 'hydrated'
  /**
   * A root reaches the subject and React had not committed it when the wait
   * stopped: still dehydrated, or created and not yet rendered, with no work
   * React could do and nothing outstanding that could give it some. The fibers a
   * component is read from are missing or work in progress, and nothing is
   * read off them (`resolveProvenance` answers `'uncommitted'`). An effect that
   * runs after hydration can still change the image, so a collector refuses a
   * subject in this state, as it refuses one still showing a fallback.
   */
  | 'hydrating'
  /**
   * No React root reached the subject. Either React does not render it, or its
   * client had not created a root when nothing more was arriving: at the moment
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
  /**
   * `false` when the tap saw no React renderer load on the page, which is why
   * an `unrooted` subject was read without waiting. Absent when there was no
   * tap to ask, or React had loaded.
   */
  readonly loaded?: false;
  /**
   * How hydration changed the subject's markup, when it was waited for with an
   * attached tap and did: the first difference, as the server sent it and as
   * the client left it.
   */
  readonly changed?: MarkupChange;
}

/** The first place two readings of a subject's markup differ, with some context either side. */
export interface MarkupChange {
  /** The markup around the difference before hydration. */
  readonly before: string;
  /** The same place once React had finished the work hydration left. */
  readonly after: string;
  /** Components that committed after the hydration commit, most commits first. */
  readonly components?: readonly string[];
}

const DEFAULT_POLL_MS = 16;
/** Characters of markup kept either side of a difference. */
const CONTEXT = 40;

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
  const pollMs = Math.max(1, options.pollMs ?? DEFAULT_POLL_MS);
  const tap = options.tap?.attached === true ? options.tap : undefined;
  const started = now();
  // What the subject looked like when it first had to be waited for, and where
  // React's commit stream stood then: past it, the first `hydrating` commits
  // are the hydration itself, and anything after them is the client changing it.
  let before: { readonly markup: string; readonly commit: number; readonly hydrating: number } | undefined;

  for (;;) {
    const roots = rootsReaching(node);
    let pending = 0;
    let working = tap?.effectsPending() === true;
    for (const root of roots) {
      if (rootCommitted(root)) continue;
      pending += 1;
      if (rootHasWork(root)) working = true;
    }

    if (roots.size > 0 && pending === 0) {
      const settled = { state: 'hydrated' as const, roots: roots.size, pending: 0 };
      if (before === undefined || tap === undefined) return { ...settled, waitedMs: now() - started };
      const changed = await changeAfter(node, before, tap, pollMs);
      return { ...settled, waitedMs: now() - started, ...(changed !== undefined ? { changed } : {}) };
    }
    // Asked once, at the start: a renderer that had not loaded by then is not
    // loading while the page agent holds the thread between polls.
    if (roots.size === 0 && before === undefined && tap !== undefined && tap.reactVersion === undefined) {
      return { state: 'unrooted', roots: 0, pending: 0, waitedMs: now() - started, loaded: false };
    }

    if (tap !== undefined) {
      before ??= { markup: markupOf(node), commit: tap.dropped() + tap.commits().length, hydrating: pending };
    }
    // React has a render it can do, or effects it has not run: it moves on its
    // own, and the next read sees where it got to.
    if (working) {
      await sleep(pollMs);
      continue;
    }
    // React can do nothing until something outside it answers. Waited for only
    // while something still might.
    if (options.outstanding === undefined || !(await options.outstanding())) {
      return {
        state: roots.size === 0 ? 'unrooted' : 'hydrating',
        roots: roots.size,
        pending,
        waitedMs: now() - started,
      };
    }
  }
}

/**
 * The subject's markup once React has finished the work hydration left, compared
 * with what it was before the wait, or `undefined` when the two agree.
 *
 * Finished first, because hydration commits the server's markup by
 * construction: whatever the client changes, it changes in an effect, and an
 * effect commits after the hydration commit this wait returned on. Finished is
 * React's own record, not a stretch of silence: every root reaching the subject
 * committed with no lane it can render, and every commit's passive effects run.
 * An effect that updates state leaves a lane pending, so the wait follows the
 * chain of commits it starts to its end, however long that takes.
 */
async function changeAfter(
  node: Node,
  from: { readonly markup: string; readonly commit: number; readonly hydrating: number },
  tap: CommitTap,
  pollMs: number,
): Promise<MarkupChange | undefined> {
  while (tap.effectsPending() || [...rootsReaching(node)].some((root) => !rootCommitted(root) || rootHasWork(root))) {
    await sleep(pollMs);
  }
  const before = from.markup;
  const after = markupOf(node);
  if (after === before) return undefined;

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1;
  }
  const excerpt = (markup: string): string => {
    const from = Math.max(0, start - CONTEXT);
    const to = Math.min(markup.length, markup.length - end + CONTEXT);
    return (from > 0 ? '…' : '') + markup.slice(from, to) + (to < markup.length ? '…' : '');
  };

  // Indexed from the stream's start rather than the retained window, which
  // drops its oldest commit once it is full.
  const components = restlessIn(
    tap.commits().slice(Math.max(0, from.commit + from.hydrating - tap.dropped())),
  ).map((component) => component.name);
  return {
    before: excerpt(before),
    after: excerpt(after),
    ...(components.length > 0 ? { components } : {}),
  };
}

function markupOf(node: Node): string {
  const element = node as Partial<Element>;
  if (typeof element.outerHTML === 'string') return element.outerHTML;
  return (node as Partial<Document>).documentElement?.outerHTML ?? node.textContent ?? '';
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

function now(): number {
  const clock = globalThis.performance;
  return clock && typeof clock.now === 'function' ? clock.now() : Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
