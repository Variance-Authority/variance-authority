---
'@variance-authority/react': minor
'@variance-authority/route-collector': minor
---

A route's components are read after React has hydrated it, and a route read before says so

The route collector waited for hydration by watching the number of nodes
carrying a fiber until it held still. A shell that suspends during hydration,
on a promise read outside any `<Suspense>`, leaves fibers on the nodes rendered
before it while the root is still uncommitted, so the wait ended there and the
nodes past it came back with no component. On a loaded machine hydration
finishes later, and a changed region named no component on one run and its
component on the next.

`awaitHydration` now reads React's record of each root on, above (up to the
`Document`, for an app that hydrates the whole page), under and behind the
subject, and waits until every one has committed. It returns `state`:
`hydrated`, `hydrating` or `unrooted`, with `roots`, `pending` and `waitedMs`;
`hydrated: boolean`, `fibers` and the `confirmations` option are gone.

A route still hydrating when the wait runs out is refused with the number of
roots that had not committed, as a route still showing a Suspense fallback is:
an effect that runs after hydration can paint a different image. A route with
no React root is collected with a `react-root-absent` warning, so a region with
no component says why. A run with `wiring: false` waits for nothing and says
nothing. The new `hydrationTimeoutMs` option sets the wait, `2000` by default.

`resolveProvenance`, `wiringOf` and `holdingOf` read nothing off a node whose
root has not committed. `resolveProvenance` returns the new `UNCOMMITTED`
sentinel, reason `'uncommitted'`, for it, where it used to resolve the
component of a render React had not committed. A root that committed `null`
now reads as committed.
