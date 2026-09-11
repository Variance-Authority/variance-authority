import { jsxSourceOf, type SourceLocation } from '@variance-authority/core/format';
import { isOwnerFrame, type Fiber } from './fiber.js';

/** The default upper bound for a read-only Fiber walk. */
const DEFAULT_FIBER_LIMIT = 500_000;

export interface FiberWalkOptions {
  /** Maximum fibers visited before the result reports truncation. */
  readonly limit?: number;
}

export interface FiberWalkResult {
  readonly visited: number;
  readonly truncated: boolean;
}

/**
 * Visit one Fiber subtree in depth-first tree order without crossing into the
 * root's siblings.
 *
 * Returning `false` prunes that fiber's children. Siblings remain part of the
 * walk. Cycles and malformed sibling links are tolerated through identity
 * tracking and the same explicit bound every other traversal in this package
 * carries.
 */
export function walkFiberSubtree(
  root: Fiber,
  visit: (fiber: Fiber, depth: number) => boolean | void,
  options: FiberWalkOptions = {},
): FiberWalkResult {
  const limit = boundedLimit(options.limit);
  const stack: { fiber: Fiber; depth: number; root: boolean }[] = [
    { fiber: root, depth: 0, root: true },
  ];
  const seen = new Set<Fiber>();
  let visited = 0;

  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined || seen.has(entry.fiber)) continue;
    if (visited >= limit) return { visited, truncated: true };

    seen.add(entry.fiber);
    visited += 1;
    const descend = visit(entry.fiber, entry.depth) !== false;

    if (!entry.root && entry.fiber.sibling !== null) {
      stack.push({ fiber: entry.fiber.sibling, depth: entry.depth, root: false });
    }
    if (descend && entry.fiber.child !== null) {
      stack.push({ fiber: entry.fiber.child, depth: entry.depth + 1, root: false });
    }
  }

  return { visited, truncated: false };
}

export interface FiberChainResult {
  /** Starting fiber first, then each `return` parent. */
  readonly fibers: readonly Fiber[];
  /** True when a cycle or the requested bound stopped the walk. */
  readonly truncated: boolean;
}

/** Walk the structural `return` chain, including the starting fiber. */
export function fiberParentChain(
  fiber: Fiber,
  options: FiberWalkOptions = {},
): FiberChainResult {
  const limit = boundedLimit(options.limit);
  const fibers: Fiber[] = [];
  const seen = new Set<Fiber>();
  let current: Fiber | null = fiber;

  while (current !== null && fibers.length < limit && !seen.has(current)) {
    fibers.push(current);
    seen.add(current);
    current = current.return;
  }

  return { fibers, truncated: current !== null };
}

/** Composite frames enclosing this Fiber, innermost first. */
export function componentFiberPath(
  fiber: Fiber,
  options: FiberWalkOptions = {},
): FiberChainResult {
  const chain = fiberParentChain(fiber, options);
  return {
    fibers: chain.fibers.filter(isOwnerFrame),
    truncated: chain.truncated,
  };
}

/**
 * The exact JSX coordinate carried by this Fiber, or by the nearest enclosing
 * composite that retained it after a custom JSX runtime rebuilt the props.
 */
export function fiberSourceLocation(fiber: Fiber): SourceLocation | undefined {
  const direct = recordedLocation(fiber);
  if (direct !== undefined) return direct;

  for (
    let ancestor = fiber.return;
    ancestor !== null && isOwnerFrame(ancestor);
    ancestor = ancestor.return
  ) {
    const enclosing = recordedLocation(ancestor);
    if (enclosing !== undefined) return enclosing;
  }
  return undefined;
}

function recordedLocation(fiber: Fiber): SourceLocation | undefined {
  const recorded = jsxSourceOf(fiber.memoizedProps);
  if (recorded !== undefined) return recorded;

  const source = fiber._debugSource;
  if (
    source === null ||
    source === undefined ||
    typeof source.fileName !== 'string' ||
    typeof source.lineNumber !== 'number'
  ) {
    return undefined;
  }
  return {
    file: source.fileName,
    line: source.lineNumber,
    column: typeof source.columnNumber === 'number' ? source.columnNumber : 0,
  };
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_FIBER_LIMIT;
  if (!Number.isFinite(limit)) return DEFAULT_FIBER_LIMIT;
  return Math.max(1, Math.floor(limit));
}
