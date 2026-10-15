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
 * tell them apart: a root that has rendered at least once has a
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
