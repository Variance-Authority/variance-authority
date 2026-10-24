import { FiberTag, type Fiber } from './fiber.js';
import { alignedCellsOf, type AlignedCell } from './holding.js';
import { contextReadsOf, inputPropNames } from './inputs.js';

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
  /** A class component's `this.state` is a different object. */
  | { readonly kind: 'state'; readonly before: unknown; readonly after: unknown }
  /**
   * Retained state that could not be read, so whether it moved is not known: a
   * build with no hook record, or `hook`, the first call the reader does not
   * know, past which the cells cannot be told apart. Said beside what could be
   * read, and never as "nothing moved".
   */
  | { readonly kind: 'unread'; readonly hook?: string }
  /** A context the component reads was provided a different value. */
  | { readonly kind: 'context'; readonly name: string; readonly before: unknown; readonly after: unknown }
  /** No input moved and the props object is new: the parent rendered it again. */
  | { readonly kind: 'parent' }
  /** No input moved and the props object is the same one. A cause this reader does not see, such as `forceUpdate`. */
  | { readonly kind: 'unseen' };

/**
 * Why `fiber` rendered: every input that moved since its `alternate`, props in
 * key order, then state — hooks in call order, or a class's state — then
 * contexts in read order; `mount` or `parent` or `unseen` alone when none did
 * and all of them were read.
 *
 * The values are the live ones, so a caller decides what to show of them and
 * nothing is copied for a caller that only counts.
 */
export function renderCausesOf(fiber: Fiber): readonly RenderCause[] {
  const before = fiber.alternate;
  if (before === null) return [{ kind: 'mount' }];

  const causes: RenderCause[] = [...propsMoved(before, fiber), ...stateMoved(before, fiber), ...contextsMoved(before, fiber)];
  if (causes.length > 0) return causes;
  return [before.memoizedProps === fiber.memoizedProps ? { kind: 'unseen' } : { kind: 'parent' }];
}

/** The props that are inputs on either side, by {@link inputPropNames}. */
function propsMoved(before: Fiber, after: Fiber): RenderCause[] {
  const was = before.memoizedProps ?? {};
  const now = after.memoizedProps ?? {};
  if (was === now) return [];
  const names = [...new Set([...inputPropNames(was), ...inputPropNames(now)])].sort();
  return names
    .filter((name) => !Object.is(was[name], now[name]))
    .map((name) => ({ kind: 'prop', name, before: was[name], after: now[name] }));
}

/** A class's state is one object `setState` replaces; a function component's is its hook cells. */
function stateMoved(before: Fiber, after: Fiber): RenderCause[] {
  if (after.tag !== FiberTag.ClassComponent) return hooksMoved(before, after);
  return Object.is(before.memoizedState, after.memoizedState) ? [] : [{ kind: 'state', before: before.memoizedState, after: after.memoizedState }];
}

/**
 * Cells of retained state whose value moved. Only state: a memo's deps or an
 * effect's are recomputed by the render, so they move because it happened and
 * never cause one. A side the reader could not align ends the list with
 * `unread`, so what it could not see is never said as held.
 */
function hooksMoved(before: Fiber, after: Fiber): RenderCause[] {
  // No cell on either side is a component that retains nothing, whatever the build recorded.
  if (before.memoizedState == null && after.memoizedState == null) return [];
  const prior = alignedCellsOf(before);
  const current = alignedCellsOf(after);
  const moved = cellsMoved(prior.cells ?? [], current.cells ?? []);
  if (prior.cells === undefined || current.cells === undefined) return [...moved, { kind: 'unread' }];
  const hook = current.unread ?? prior.unread;
  return hook === undefined ? moved : [...moved, { kind: 'unread', hook }];
}

function cellsMoved(was: readonly AlignedCell[], now: readonly AlignedCell[]): RenderCause[] {
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
  for (const read of contextReadsOf(before)) if (!previous.has(read.context)) previous.set(read.context, read.value);
  const moved: RenderCause[] = [];
  for (const read of contextReadsOf(after)) {
    if (!previous.has(read.context) || Object.is(previous.get(read.context), read.value)) continue;
    moved.push({ kind: 'context', name: read.name, before: previous.get(read.context), after: read.value });
    previous.delete(read.context);
  }
  return moved;
}
