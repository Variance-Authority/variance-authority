/**
 * Whether React has committed this `FiberRoot`, read off its current `HostRoot`.
 *
 * INTERNAL CONTRACT: `HostRoot.memoizedState` is `{ element, isDehydrated, … }`
 * in React 18 and 19. `hydrateRoot` starts it with `isDehydrated: true` and the
 * hydration commit replaces it; `createRoot` starts it with `element: null` and
 * the first commit puts the rendered element there. React 17's legacy
 * `hydrate` and `render` commit synchronously, so a reader never sees them
 * mid-flight.
 *
 * A root whose committed element *is* `null` — `root.render(null)`, or a root
 * unmounted while something still holds it — has the same state as one never
 * rendered, so `element` alone cannot tell them apart. Two more fields can: a
 * root that has rendered at least once has a `current.alternate`, and one with
 * no work left has `pendingLanes === 0` (React marks a lane finished at its
 * commit, and keeps a suspended one pending). A root created and never asked to
 * render reads as not committed, which it is.
 *
 * If React renames any of these, the symptom is a subject that reads as not
 * committed on every page: refused by name in every report, rather than quiet.
 */
export function rootCommitted(root: object): boolean {
  const fiberRoot = root as {
    readonly current?: { readonly memoizedState?: unknown; readonly alternate?: unknown } | null;
    readonly pendingLanes?: unknown;
  };
  const state = fiberRoot.current?.memoizedState as
    | { readonly element?: unknown; readonly isDehydrated?: unknown }
    | null
    | undefined;
  if (state === null || state === undefined) return false;
  if (state.isDehydrated === true) return false;
  if (state.element !== null && state.element !== undefined) return true;
  const rendered = fiberRoot.current?.alternate !== null && fiberRoot.current?.alternate !== undefined;
  return rendered && fiberRoot.pendingLanes === 0;
}
