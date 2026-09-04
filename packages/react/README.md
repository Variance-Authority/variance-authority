<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/react

> Read React provenance from rendered DOM nodes: owner chains, props digests and portals, without importing the app’s React.

This package reads **provenance**: React's own record of which components
produced a piece of DOM. For one node that means three things — its **owner
chain**, the composite components enclosing it, innermost first; a **props
digest** at each one, hashing that component's own props and excluding children;
and whether the node arrived through a **portal**.

A portal is content `createPortal` puts elsewhere in the document while it stays
part of the component tree rooted at the **subject** — the component, page, or
story a capture is taken of.

It reads metadata that `react-dom` attached to the DOM nodes, and never imports
the application's React package, so it cannot pin, duplicate, or replace that
copy. What it does need is a tree `react-dom` actually rendered.

```bash
npm install --save-dev @variance-authority/react
```
## Use this package when

Use it once `react-dom` has already mounted the element you want to inspect.
It reads React's fiber metadata; it does not render components, install a
test runner, or replace the application's React copy.

**Don't use it** to capture the DOM itself — that's `@variance-authority/dom`,
which this package's output plugs into via the `provenanceOf` callback below.
And there is nothing to read if nothing mounted: a static page, a non-React
widget, or server-rendered markup the client never hydrated all make
`provenanceOf` return `undefined`, not an error.

## Smallest working path

Given a mounted element, `provenanceOf` returns the `Provenance` value defined
by `@variance-authority/core`: the owner chain, a props digest at each
boundary, and the component that authored the element.

```ts
import { provenanceOf } from '@variance-authority/react';

const element = document.querySelector('[data-test="subject"]');
if (element === null) throw new Error('React subject is not mounted');

const provenance = provenanceOf(element);
if (provenance === undefined) {
  console.log('React did not render this node');
} else {
  console.log(provenance.owners.map((owner) => owner.name));
}
```

To include the same data in a semantic capture, pass `provenanceOf` to
`collect(root, { subject, viewport, engine, provenanceOf })`. The callback is
optional: without it, the DOM package still captures the node but cannot name a
component.

## What else it reads off the same fiber

The same fiber answers seven distinct questions. Most need no hook, build plugin
or annotation; commit evidence needs the hook React already offers renderers.

| | |
|---|---|
| `wiringOf` | hook shape, wrapper chain, context subscriptions, reconciliation keys — a **band** (one of the categories VA reports changes under, like `style`), folded in beside `style` by `collect` |
| `holdingOf` | what a component was handed and what it retained — props, contexts and hook cells, each as a digest — **evidence**: it rides beside the snapshot, enters no hash, and is read by `partingOf` to say which input a difference came from |
| `remountedSince` | which instances were destroyed and rebuilt rather than updated — a **finding**: a fact about this one reading, not a diff between two revisions |
| `awaitSuspense` / `suspenseRefusal` | wait for every boundary under a node to settle, and rule on what to do if one did not |
| `tapCommits` / `awaitQuiet` | which components performed work, and which live component instances initiated each commit — the one instrument here with a precondition: it must be installed before `react-dom` loads, and refuses rather than reporting a page it reached too late |
| `memoizedUpdatersOf` | React's `memoizedUpdaters` set as portable structural component paths, with an optional JSX source coordinate |
| `walkFiberSubtree` / `fiberParentChain` / `componentFiberPath` / `fiberSourceLocation` | bounded read-only traversal for a caller that already has a Fiber |

Every shipped collector calls the Suspense pair before it reads a page: the
page waits and reports, the driver decides. `awaitSuspense` returns `settled`,
`pending` or `unobserved` — three states, so a page with no React under it can
never claim to have arrived. `suspenseRefusal` turns a `pending` or
`unobserved` settlement into a **Suspense refusal**: a `string` telling the
caller to fail the run rather than capture the subject mid-arrival, or
`undefined` when the wait genuinely succeeded — a shape a caller cannot
accidentally downgrade to a warning.

The commit tap is different: it is not installed by a host that reaches an
already-loaded page. Call `tapCommits()` before `react-dom` is imported, then
pass the returned tap to `awaitQuiet` when a runner needs a component-level
readiness signal. An init script can satisfy the same ordering for a page the
host is about to navigate. If React was already loaded, the tap reports
`attached: false` rather than pretending the page was quiet.

Each retained commit keeps two independent readings. `components` comes from
React's `PerformedWork` flags and says which component render bodies ran.
`updaters` comes from the root's `memoizedUpdaters` and says which live instances
initiated the update. An updater is a component path, innermost first, whose
frames carry the component name, reconciliation key, and props digest; `source`
is included when the Fiber exposes a JSX coordinate. A missing `updaters` means
the renderer did not expose the set. An empty array means it exposed the set and
the commit had no retained updater, as on an initial mount.

The traversal exports take raw Fiber objects rather than DOM nodes. Subtree
walks do not cross the supplied root's sibling, parent walks follow the
structural `return` chain rather than `_debugOwner`, and every result states
whether its explicit `limit` or a malformed cycle truncated the read.

The readiness options are caller policy, not hidden defaults:

| call | useful controls |
|---|---|
| `tapCommits` | `scope` supplies an isolated hook object, `nameLimit` bounds rendered-component traversal, `updaterLimit` bounds update initiators, `keep` bounds retained commits, `onCommit` streams the same portable record, `refuseIfLoaded` keeps a late tap from claiming coverage, and `createHook` withholds the hook a caller that could not have loaded first would be writing for nobody |
| `awaitQuiet` | `quietFor` is the required silence, `timeout` bounds the wait, and `interval` controls polling; a timeout returns `settled: false` with restless component names |
| `awaitSuspense` | `timeoutMs`, `pollMs`, and `confirmations` bound the boundary check; a pending or unobserved result is returned for the page agent to rule on |

## Two constraints shape everything here

**1. Engine independence.** Traversal reads plain JavaScript objects React
attached to DOM nodes. Nothing touches layout, `getComputedStyle`, or any
Chromium-only API — which is why the same owner chains come out of jsdom and a
real browser, and why the cheap tier can carry the full provenance dimension in
milliseconds instead of paying for a browser to get it.

**2. No DevTools hook required.** The primary path is the `__reactFiber$…`
expando `react-dom` writes onto every host node it creates. The global hook is
consulted only for the exact React version, and only if it happens to exist.

## Why provenance is load-bearing, not decoration

Provenance does two jobs. It attributes a region to the component that
produced it, and it draws the subject's boundary by the component tree rather
than by DOM containment — so content a component renders through a portal
elsewhere in the document still counts as part of the subject. Owner chains
also drive differ matching, not just reporting: a tree matched without them
matches by DOM position, and a reordered list looks like every item changed.

## Honest limits

- **A source location needs a React development build, and nothing else.**
  React 19 drops what the transform computed — `jsxDEV` takes four parameters and
  overwrites the fifth, `createElement` skips `__source` by name — and replaces
  it with something better: an `Error` captured inside its own element factory,
  kept on every fiber as `_debugStack`. `resolveProvenance` reads the first frame
  in it that is not vendor code and hands the candidates on as
  `Provenance.stack`, where they ride the snapshot unspent until a region or a
  finding names the node — then `locateSites` resolves them through the source
  map the build already emits and fills in `source`. Nothing is asked of the build:
  no plugin, no `jsxImportSource`, no `jsxDev`. It reaches the classic transform
  too, because React captures the same error in `createElement`.

  A **production** build has no such error, and that is where
  `@variance-authority/jsx-source` comes in — a bundler plugin
  or a Jest resolver, still without taking `jsxImportSource`. An element whose
  props were rebuilt by a custom runtime records one fiber up, and
  `resolveProvenance` climbs composite ancestors to find it.

  **React 18 is served first and more cheaply.** It kept the transform's own
  `{fileName, lineNumber, columnNumber}` on the fiber as `_debugSource`, which
  `resolveProvenance` reads before it looks at any stack — a location the
  compiler already computed needs no frame, no module fetch and no source map.
  A React 18 dev server therefore costs nothing at all for what React 19 spends
  a map hop on. The one combination with no answer is React 18 *and* the classic
  transform, where the compiler emits no `__source` and React captures no error
  to replace it; that corner is the plugin's.

  With none of the three, attribution falls back to resolving a component *name*
  against a repository scan (`core/attribute`'s `indexSource`) — the
  declaration rather than the call site.
- **A node React never rendered has no chain**, and says so — `NO_FIBER` with a
  reason, never an empty chain that reads like "no components involved".

If the element has no React fiber, or the application uses a production build
without source metadata, the result is intentionally incomplete. `provenanceOf`
does not guess a component from the DOM; use the name scan in `core/attribute` or
install `@variance-authority/jsx-source` for production call-site
locations.
