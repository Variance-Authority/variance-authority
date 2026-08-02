import { FiberTag, currentFiber, findFiber, type Fiber } from './fiber.js';

/**
 * Portal discovery.
 *
 * A subject's boundary is a **component-tree** question, not a DOM-containment
 * one. `createPortal` renders into a host elsewhere in the document — usually
 * `document.body` — while remaining, in every sense that matters, part of the
 * tree rooted at the subject.
 *
 * Reading the boundary as DOM containment produces a false `unchanged`, and the
 * corpus measured it: opening a modal moves 342 bytes out of the subject's
 * container into the portal host, leaving the container byte-identical. A
 * dialog opening would report as no change at all — the exact failure ADR-0002
 * exists to prevent, arriving through a door ADR-0002 did not cover.
 *
 * See ADR-0007.
 */

const HOST_TAGS = new Set<number>([
  FiberTag.HostComponent,
  FiberTag.HostHoistable,
  FiberTag.HostSingleton,
]);

/**
 * Top-level elements this subtree renders through portals, in fiber traversal
 * order.
 *
 * Returns the portal's *content* rather than its container. The container is
 * typically `document.body`, and capturing it would pull in the entire page —
 * every other subject, the test harness chrome, and any sibling portal — which
 * would make one subject's hash depend on what else happened to be mounted.
 *
 * Order is fiber traversal order, not DOM order, so it does not depend on where
 * in the container the portal happened to be appended.
 */
export function portalContentOf(root: Element): Element[] {
  const fiber = subtreeFiber(root);
  if (!fiber) return [];

  const found: Element[] = [];
  collectPortals(fiber.child, found, new Set());
  return found;
}

/**
 * The fiber whose subtree corresponds to `root`.
 *
 * The direct lookup misses the most common case. A subject root is very often
 * the element a React root was mounted *into* — a Storybook canvas, a test
 * container — and `react-dom` marks those with `__reactContainer$`, not the
 * `__reactFiber$` expando `findFiber` reads. So the element React renders
 * *through* has no fiber of its own, and asking it directly returns nothing.
 *
 * The fallback finds a rendered descendant and climbs to the `HostRoot`, whose
 * subtree is exactly what the container renders.
 */
function subtreeFiber(root: Element): Fiber | null {
  const own = findFiber(root);
  if (own) return own;

  const descendants = root.querySelectorAll('*');
  for (let index = 0; index < descendants.length; index += 1) {
    const element = descendants[index];
    if (!element) continue;

    const fiber = findFiber(element);
    if (!fiber) continue;

    return currentFiber(topOf(fiber)) ?? topOf(fiber);
  }

  return null;
}

function topOf(fiber: Fiber): Fiber {
  let node = fiber;
  // Bounded: a corrupt `return` chain must not hang the collector.
  for (let depth = 0; depth < 10_000 && node.return; depth += 1) {
    node = node.return;
  }
  return node;
}

/**
 * Walk siblings and children looking for `HostPortal` fibers.
 *
 * Descent stops at a portal's host children: the collector walks their DOM
 * subtrees itself, and continuing here would duplicate that work and, worse,
 * emit the same element twice if a nested portal targeted an ancestor.
 */
function collectPortals(start: Fiber | null, found: Element[], seen: Set<Element>): void {
  let fiber = start;

  while (fiber) {
    if (fiber.tag === FiberTag.HostPortal) {
      collectPortalHosts(fiber.child, found, seen);
      // Do not descend past the portal here — `collectPortalHosts` handles its
      // content, including any portal nested inside it.
      fiber = fiber.sibling;
      continue;
    }

    if (fiber.child) collectPortals(fiber.child, found, seen);
    fiber = fiber.sibling;
  }
}

/** The host elements a portal renders, skipping composite fibers in between. */
function collectPortalHosts(start: Fiber | null, found: Element[], seen: Set<Element>): void {
  let fiber = start;

  while (fiber) {
    if (HOST_TAGS.has(fiber.tag)) {
      const element = fiber.stateNode;
      if (isElement(element) && !seen.has(element)) {
        seen.add(element);
        found.push(element);
      }
      // Its DOM subtree belongs to the collector. But a portal nested *inside*
      // this element's React subtree still needs finding, and it is not
      // reachable by walking the DOM.
      if (fiber.child) collectPortals(fiber.child, found, seen);
      fiber = fiber.sibling;
      continue;
    }

    if (fiber.tag === FiberTag.HostPortal) {
      collectPortalHosts(fiber.child, found, seen);
      fiber = fiber.sibling;
      continue;
    }

    if (fiber.child) collectPortalHosts(fiber.child, found, seen);
    fiber = fiber.sibling;
  }
}

function isElement(value: unknown): value is Element {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { nodeType?: number }).nodeType === 1
  );
}
