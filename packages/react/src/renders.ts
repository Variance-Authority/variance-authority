import type { Fiber } from './fiber.js';
import { alignedCellsOf } from './holding.js';

/**
 * Why a component rendered, read off the commit it rendered in.
 *
 * `holding.ts` reads what a component held so two readings can be told apart.
 * This reads the same cells across one render instead: a fiber that did work
 * in a commit and the `alternate` it was built from, which is what the
 * component rendered last time. React keeps both until the next render, so the
 * question React DevTools' profiler answers — *why did this render* — is a
 * comparison of two records already in memory, and nothing has to be patched
 * or wrapped to ask it.
 *
 * The answer is the inputs that moved, by `Object.is`, which is React's own
 * test: a prop, a cell of retained state, a context value. A component none of
 * whose inputs moved rendered because its parent did and nothing stopped the
 * render on the way down — the cause a `memo` would have removed.
 */
export type RenderCause =
  /** No previous render: the component mounted in this commit. */
  | { readonly kind: 'mount' }
  /** A prop other than `children` holds a different value. */
  | { readonly kind: 'prop'; readonly name: string; readonly before: unknown; readonly after: unknown }
  /** A cell of retained state, by the hook call's position, holds a different value. */
  | { readonly kind: 'hook'; readonly hook: string; readonly index: number; readonly before: unknown; readonly after: unknown }
  /** A context the component reads was provided a different value. */
  | { readonly kind: 'context'; readonly name: string; readonly before: unknown; readonly after: unknown }
  /** No input moved and the props object is new: the parent rendered it again. */
  | { readonly kind: 'parent' }
  /** No input moved and the props object is the same one. A cause this reader does not see, such as `forceUpdate`. */
  | { readonly kind: 'unseen' };

/** Bounds the context list walk, as `holding.ts` does. */
const MAX_CONTEXTS = 256;

/**
 * Why `fiber` rendered: every input that moved since its `alternate`, props in
 * key order, then hooks in call order, then contexts in read order; `mount` or
 * `parent` or `unseen` alone when none did.
 *
 * The values are the live ones, so a caller decides what to show of them and
 * nothing is copied for a caller that only counts.
 */
export function causesOf(fiber: Fiber): readonly RenderCause[] {
  const before = fiber.alternate;
  if (before === null) return [{ kind: 'mount' }];

  const causes: RenderCause[] = [...propsMoved(before, fiber), ...hooksMoved(before, fiber), ...contextsMoved(before, fiber)];
  if (causes.length > 0) return causes;
  return [before.memoizedProps === fiber.memoizedProps ? { kind: 'unseen' } : { kind: 'parent' }];
}

/** `children` is left out for `holding.ts`'s reason: it is the subtree, new on every render of the parent. */
function propsMoved(before: Fiber, after: Fiber): RenderCause[] {
  const was = before.memoizedProps ?? {};
  const now = after.memoizedProps ?? {};
  if (was === now) return [];
  const names = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((name) => name !== 'children').sort();
  return names
    .filter((name) => !Object.is(was[name], now[name]))
    .map((name) => ({ kind: 'prop', name, before: was[name], after: now[name] }));
}

/**
 * Cells of retained state whose value moved. Only state: a memo's deps or an
 * effect's are recomputed by the render, so they move because it happened and
 * never cause one.
 */
function hooksMoved(before: Fiber, after: Fiber): RenderCause[] {
  const was = alignedCellsOf(before).cells ?? [];
  const now = alignedCellsOf(after).cells ?? [];
  const previous = new Map(was.map((cell) => [cell.index, cell]));
  const moved: RenderCause[] = [];
  for (const cell of now) {
    const prior = previous.get(cell.index);
    if (cell.read !== 'value' || prior === undefined || prior.hook !== cell.hook) continue;
    if (!Object.is(prior.value, cell.value)) {
      moved.push({ kind: 'hook', hook: cell.hook, index: cell.index, before: prior.value, after: cell.value });
    }
  }
  return moved;
}

/** Contexts are matched by the context object, so two that share a display name stay two. */
function contextsMoved(before: Fiber, after: Fiber): RenderCause[] {
  const previous = new Map<unknown, unknown>();
  let link = before.dependencies?.firstContext;
  for (let seen = 0; seen < MAX_CONTEXTS && link; seen += 1, link = link.next) {
    if (!previous.has(link.context)) previous.set(link.context, link.memoizedValue);
  }
  const moved: RenderCause[] = [];
  link = after.dependencies?.firstContext;
  for (let seen = 0; seen < MAX_CONTEXTS && link; seen += 1, link = link.next) {
    if (!previous.has(link.context) || Object.is(previous.get(link.context), link.memoizedValue)) continue;
    const displayName = link.context?.displayName;
    const name = typeof displayName === 'string' && displayName !== '' ? displayName : '(anonymous)';
    moved.push({ kind: 'context', name, before: previous.get(link.context), after: link.memoizedValue });
    previous.delete(link.context);
  }
  return moved;
}
