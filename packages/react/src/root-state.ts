/**
 * Whether React has committed this `FiberRoot`, read off its current `HostRoot`.
 *
 * INTERNAL CONTRACT: `HostRoot.memoizedState` is `{ element, isDehydrated, … }`
 * in React 18 and 19, and `{ element }` in React 17. `hydrateRoot` starts it
 * with `isDehydrated: true` and the hydration commit replaces it; `createRoot`
 * starts it with `element: null` and the first commit puts the rendered element
 * there. React 17's legacy `hydrate` and `render` commit synchronously, so a
 * reader never sees them mid-flight.
 *
 * `isDehydrated` is not trusted alone. A hydrating root already holds its
 * element, so a root whose flag had been renamed would read as committed and
 * let a capture through mid-hydration. What holds whatever the flag is called is
 * the tree: until React commits, the current `HostRoot` has no `child`.
 *
 * A root whose committed element renders nothing — `root.render(null)` or
 * `render(false)`, or a root unmounted while something still holds it — has no
 * `child` either, and the same state as one never rendered. Two more fields
 * tell them apart: a root that has started a render has a
 * `current.alternate`, and one with no work left has `pendingLanes === 0`
 * (React marks a lane finished at its commit, and keeps a suspended or
 * in-progress one pending). A root created and never asked to render reads as
 * not committed, which it is.
 *
 * Every answer fails closed. A state with no `element` key, or a renamed
 * `current`, reads as not committed. A renamed `isDehydrated` or `child` leaves
 * the answer to `alternate` and `pendingLanes`, which still read a hydrating
 * root as pending, and a renamed `pendingLanes` reads every root with nothing
 * in `child` as not committed. Each of those refuses the subject by name
 * rather than reading it off a render nobody can vouch for.
 */
export function rootCommitted(root: object): boolean {
  const fiberRoot = root as {
    readonly current?: {
      readonly memoizedState?: unknown;
      readonly alternate?: unknown;
      readonly child?: unknown;
    } | null;
    readonly pendingLanes?: unknown;
  };
  const current = fiberRoot.current;
  const state = current?.memoizedState as
    | { readonly element?: unknown; readonly isDehydrated?: unknown }
    | null
    | undefined;
  if (current === null || current === undefined) return false;
  if (state === null || state === undefined || !('element' in state)) return false;
  if (state.isDehydrated === true) return false;
  const element = state.element !== null && state.element !== undefined;
  if (element && current.child !== null && current.child !== undefined) return true;
  const rendered = current.alternate !== null && current.alternate !== undefined;
  return rendered && fiberRoot.pendingLanes === 0;
}

/**
 * Whether the commit React is announcing for this `FiberRoot` hydrated it: the
 * `HostRoot` it replaced was dehydrated and the one it committed is not.
 *
 * INTERNAL CONTRACT: `isDehydrated` on `HostRoot.memoizedState`, as
 * `rootCommitted` reads it. When React announces a commit, `current` is the tree
 * it has just committed and `current.alternate` the one it replaced. A renamed
 * flag reads as no hydration, so no copy: a comparison that is not made rather
 * than one made against the wrong markup.
 */
export function committedHydration(root: object): boolean {
  const dehydrated = (fiber: unknown): boolean =>
    (fiber as { readonly memoizedState?: { readonly isDehydrated?: unknown } | null } | null | undefined)
      ?.memoizedState?.isDehydrated === true;
  const current = (root as { readonly current?: unknown }).current as { readonly alternate?: unknown } | undefined;
  return current !== undefined && dehydrated(current.alternate) && !dehydrated(current);
}

/**
 * Whether React has a render of this `FiberRoot` it can do now, or a commit it
 * has scheduled: a lane pending that is not suspended, a suspended one a
 * settled promise has pinged, or a finished render whose commit React holds.
 *
 * INTERNAL CONTRACT: `pendingLanes`, `suspendedLanes` and `pingedLanes` are
 * bitsets on the `FiberRoot` in React 18 and 19. A lane is pending from the
 * update that schedules it to the commit that finishes it; a render that
 * suspends marks its lanes suspended, and the promise it waits on pings them
 * when it settles. A lane suspended and not pinged is work React cannot do
 * until something outside it answers — unless React itself holds the commit.
 * It does that two ways, and marks the lanes suspended for both: content that
 * resolves soon after its fallback committed is committed on a timer, stored
 * in `timeoutHandle` and reset to `-1` when it fires; and a commit waiting on
 * stylesheets or images stores its cancel function in `cancelPendingCommit`
 * (React 19 only) and clears it to `null`.
 *
 * A renamed field reads as no work: the subject is read rather than waited on
 * forever, and `rootCommitted` still refuses one React has not committed.
 */
export function rootHasWork(root: object): boolean {
  const fields = root as {
    readonly pendingLanes?: unknown;
    readonly suspendedLanes?: unknown;
    readonly pingedLanes?: unknown;
    readonly timeoutHandle?: unknown;
    readonly cancelPendingCommit?: unknown;
  };
  const pending = typeof fields.pendingLanes === 'number' ? fields.pendingLanes : 0;
  const suspended = typeof fields.suspendedLanes === 'number' ? fields.suspendedLanes : 0;
  const pinged = typeof fields.pingedLanes === 'number' ? fields.pingedLanes : 0;
  if ((pending & ~(suspended & ~pinged)) !== 0) return true;
  if (pending === 0) return false;
  const held = fields.timeoutHandle !== undefined && fields.timeoutHandle !== -1;
  return held || typeof fields.cancelPendingCommit === 'function';
}
