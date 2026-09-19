<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/react

> Read React provenance from rendered DOM nodes: owner chains, props digests and portals, without importing the app’s React.

Part of [Variance Authority](https://variance-authority.dev).

## What you get

Hand this package a DOM node that `react-dom` mounted, and it tells you which
React components put it there:

- the **owner chain** — the composite components enclosing the node, innermost
  first;
- a **props digest** at each of them — a hash of that component's own props,
  excluding `children`, so a change below a component does not alter its digest;
- **`createdBy`** — the component whose JSX authored the element, which differs
  from the innermost owner whenever a component is passed as a prop;
- the file and line, when the build recorded one, or a shortlist of candidate
  stack frames when it did not.

It reads metadata `react-dom` already wrote onto the node. There is no
`import 'react'` anywhere in its source, so it cannot pin, duplicate or conflict
with the React copy your application ships.

Use it when you want a diff, a report or a test failure to name a
component instead of a DOM path. It does not render components, install a test
runner, or capture the DOM itself — the DOM capture is
[`@variance-authority/dom`](https://variance-authority.dev/reference/packages/dom),
and this package plugs into it.

There is nothing for it to read on a static page, a non-React widget, or
server-rendered markup the client never hydrated. Those return a named "no
fiber" result rather than an empty chain.

## Install

```bash
npm install --save-dev @variance-authority/react
```

Node 22 or later. `@variance-authority/core` comes with it; nothing else is
required.

React itself is never imported, so there is no version to match — what matters
is the expando `react-dom` writes on every host node it creates:
`__reactFiber$` on React 17 and later, `__reactInternalInstance$` on React 16.
The suite runs against React 19.2.8. Where a React version changes an answer
rather than the reading — source locations, chiefly — this page says so.

## Read one node

```ts
import { resolveProvenance } from '@variance-authority/react';

const element = document.querySelector('#card');
if (element === null) throw new Error('nothing matched #card');

const result = resolveProvenance(element);
if (result.status === 'no-fiber') {
  console.log(`no React under this node: ${result.reason}`);
} else {
  console.log(result.provenance.owners.map((owner) => owner.name));
}
```

For a node rendered by `Composer → Slot → Badge`, `result.provenance` is:

```json
{
  "owners": [
    { "name": "Badge", "propsDigest": "v1:44136fa3…", "createdBy": "Composer" },
    { "name": "Slot", "propsDigest": "v1:cc3051c0…", "createdBy": "Composer" },
    { "name": "Composer", "propsDigest": "v1:44136fa3…" }
  ],
  "createdBy": "Badge",
  "stack": [{ "url": "…/Card.tsx", "line": 14, "column": 27, "function": "Badge" }]
}
```

Digests are truncated here for width; the real value is `v1:` plus 32 hex
characters.

Two functions return this, and they differ only in what they say about failure:

| | returns | use it when |
|---|---|---|
| `resolveProvenance(node)` | `{ status: 'resolved', provenance }`, or `{ status: 'no-fiber', reason }` where `reason` is `'no-client-fiber'` or `'unmounted'` | the reason belongs in a diagnostic |
| `provenanceOf(node)` | the `Provenance` value, or `undefined` | you are filling a field that is optional anyway |

`provenanceOf` is `resolveProvenance` with the reason discarded. Neither throws:
a collector runs one of them once per node across a whole document, and one
malformed fiber aborting a capture is worse than one unattributed node.

## The second argument: keep the functions behind the names

Provenance reports a component by its *name*, and a name is one step short of a
file — two files declaring a `Button` leave it ambiguous. Pass a declaration
registry as the second argument and every component the walk names is also
stored by identity, so a debugger-protocol engine can later be asked where each
function was declared.

```ts
import { createDeclarationRegistry, provenanceOf } from '@variance-authority/react';

const declared = createDeclarationRegistry();

for (const node of document.querySelectorAll('*')) {
  provenanceOf(node, declared);
}

console.log(declared.names);     // e.g. ['Badge', 'Composer', 'Slot']
console.log(declared.functions); // the live functions, same order
```

Nothing in the registry is serialized. `names` and `functions` are parallel
arrays, and `declared.id` distinguishes this registry from the one a re-injected
bundle would build. The consumer on the Node side is
`createDeclarationReader` in
[`@variance-authority/playwright`](https://variance-authority.dev/reference/packages/playwright),
which asks the engine about `functions[i]` by handle.

The chain itself is identical with or without a registry.

A third argument, `digestPass()`, memoizes props digests by object identity for
the duration of one capture. Owner chains overlap heavily, so the same props
object is otherwise digested once per descendant: measured on MUI's
`docs-product-x/XHero`, 27,950 calls over 1,470 distinct objects. Create one per
capture and never reuse it across two, since React keeps a prop's identity while
its contents change.

```ts
import { digestPass, provenanceOf } from '@variance-authority/react';

const pass = digestPass();
for (const node of document.querySelectorAll('*')) provenanceOf(node, undefined, pass);
```

## Put it in a capture

`collect` from `@variance-authority/dom` walks a subtree and records it. It
depends on no framework, so the React readers arrive as callbacks.

```bash
npm install --save-dev @variance-authority/dom
```

It records the result under a **subject** — one named UI state you asked for and
can ask for again, such as `cart/empty`. You supply that id, the viewport, and
the identity of the browser that rendered the page, because a page cannot read
its own build string reliably.

```ts
import { collect } from '@variance-authority/dom';
import { portalContentOf, provenanceOf, wiringOf } from '@variance-authority/react';

const capture = collect(document.querySelector('#card')!, {
  subject: { id: 'cart/empty', kind: 'fixture' },
  viewport: { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' },
  engine: 'chromium@131.0.6778.33',
  provenanceOf,
  wiringOf,
  portalsOf: portalContentOf,
});
```

Every node in `capture.root` now has the `provenance` object shown above.

`portalsOf` is what makes a subject's boundary follow the component tree rather
than DOM containment. Without it, content a component renders through
`createPortal` elsewhere in the document is invisible to the capture, and the
subject's container is byte-identical whether a modal is open or closed.

## What else the same fiber answers

Everything below reads the same fiber the owner chain came from, and none of it
needs a DevTools extension.

| | |
|---|---|
| `wiringOf` | Hook shape, wrapper chain, context subscriptions and reconciliation keys — how the framework wires the component, as a value stable enough to digest. `collect` records it beside the document; two components that render identical markup but differ in wiring stop comparing as equal. Returns `undefined` for a node with no readable framework, so a non-React page is absent from this dimension rather than giving a digest of emptiness. |
| `holdingOf` | What a component was handed and what it retained — props, contexts and hook cells, each as a digest. It rides beside the snapshot and enters no hash, so it never decides a pass or fail; `partingOf` in `@variance-authority/core` reads it to say which input a difference came from. |
| `markRender` / `remountedSince` | Which component instances were destroyed and rebuilt rather than updated, over an interval you delimit. Take the mark immediately before the action; a mark taken afterwards has no earlier instance to compare against. The result describes one interval, not a difference between two revisions, so it is never digested. |
| `awaitSuspense` / `suspenseRefusal` | Wait until nothing under a node is suspended, then rule on what to do if something still is. |
| `tapCommits` / `awaitQuiet` | Which components performed render work, and which live instances initiated each commit. |
| `createDeclarationRegistry` | The registry described above. |
| `memoizedUpdatersOf` | React's `memoizedUpdaters` set as portable component paths, with a JSX source coordinate where the fiber exposes one. |
| `walkFiberSubtree` / `fiberParentChain` / `componentFiberPath` / `fiberSourceLocation` | Bounded read-only traversal for a caller that already has a Fiber rather than a DOM node. |
| `detectReactRuntime` | The exact React version when a DevTools hook happens to expose one, plus the expando convention observed on the node as a coarse major-version bound. |

### Waiting for a subject to arrive

`awaitSuspense` returns `settled`, `pending` or `unobserved` — three states, so a
page with no React under it can never claim to have arrived — alongside how long
it waited, how many boundaries it found, and which were still pending. It
defaults to a 5000 ms timeout, a 16 ms poll, and two consecutive clean reads
before it calls a subtree settled; the second read is what stops a capture
landing in the gap between one fallback leaving and the next arriving.

`suspenseRefusal` turns that reading into a verdict: a `string` telling the
caller to fail the run rather than capture a subject mid-arrival, or `undefined`
when the wait succeeded. A string is harder to downgrade to a warning than a
boolean. The route and Storybook collectors call the pair on every page they
read.

### Component-level quiet

`tapCommits` must be called before `react-dom` is imported, since it installs
the renderer hook React offers at load. Pass the returned tap to `awaitQuiet`
when a runner needs a readiness signal at component level rather than network
level. On a page that already loaded React, the tap reports `attached: false`
instead of reporting the page as quiet.

Each retained commit keeps two independent readings. `components` comes from
React's `PerformedWork` flags and says which render bodies ran. `updaters` comes
from the root's `memoizedUpdaters` and says which live instances initiated the
update — each an innermost-first component path whose frames include a name, a
reconciliation key and a props digest. A missing `updaters` means the renderer
did not expose the set; an empty array means it did and the commit had no
retained updater, as on an initial mount.

The options are caller policy rather than hidden defaults:

| call | controls |
|---|---|
| `tapCommits` | `scope` supplies an isolated hook object, `nameLimit` bounds rendered-component traversal, `updaterLimit` bounds update initiators, `keep` bounds retained commits, `onCommit` streams the same record, `refuseIfLoaded` keeps a late tap from claiming coverage, and `createHook` set to `false` skips writing a hook nobody will read |
| `awaitQuiet` | `quietFor` is the required silence, `timeout` bounds the wait, `interval` controls polling; a timeout returns `settled: false` with the restless component names |
| `awaitSuspense` | `timeoutMs`, `pollMs` and `confirmations`, as above |
| `walkFiberSubtree` | `limit` caps the fibers one read-only walk visits, 500,000 by default; at the limit the walk returns `truncated: true` rather than a short answer that looks complete |

## Where the source location comes from

Nothing here reads layout, `getComputedStyle`, or any Chromium-only API, so the
same owner chains come out of jsdom and a real browser at the same cost. The one
answer that varies is the exact call site, and it varies by React version and
build:

**React 18 development builds** keep the transform's own
`{fileName, lineNumber, columnNumber}` on the fiber as `_debugSource`. That is
read first, and it costs nothing: no stack, no module fetch, no source map.

**React 19** dropped that field — `jsxDEV` takes four parameters and overwrites
the fifth — and replaced it with an `Error` captured inside React's own element
factory, kept on each fiber as `_debugStack`. The first frames in it that are
not vendor code are recorded as `Provenance.stack` (at most four) and left
unresolved until something in the report names that node; `locateSites` in
`@variance-authority/core` then resolves them through the source map your build
already emits. No plugin, no `jsxImportSource`, no `jsxDev` setting. The classic
`createElement` transform is covered too, because React captures the same error
there.

**Production builds** capture no such error. When a report has to name the exact
JSX expression rather than the component declaration, instrument the build with
[`@variance-authority/jsx-source`](https://variance-authority.dev/reference/packages/jsx-source)
through its bundler plugin or Jest resolver. It is not required for component
attribution, which works from names alone.

With none of the three, attribution falls back to matching a component name
against a repository scan (`indexSource` in `@variance-authority/core`) — the
declaration site rather than the call site.

An element whose props were rebuilt by a custom JSX runtime — Emotion does this
for anything with a `css` prop, copying with `for…in`, which drops symbol
keys — records its location one fiber up, and the lookup climbs composite
ancestors to find it. The climb stops at the first host element, so it never
reaches past the component that rendered the node.

## Limits

- **A node React never rendered has no owner chain, and says so.** The result is
  `{ status: 'no-fiber', reason: 'no-client-fiber' }`, or `'unmounted'` for a
  node whose tree was torn down. An empty chain would be a claim — "owned by
  nobody" — and indistinguishable from a node rendered directly by a root.
- **`createdBy` is development-only.** React populates `_debugOwner` from
  `element._owner`, which production builds leave empty; the field is then
  omitted and attribution degrades to the enclosing component.
- **A props digest resolves toward shape, not identity.** A function digests as
  its name and an element as its type, so re-creating the same inline arrow does
  not register as a change — and rebinding an anonymous closure to different
  behaviour does not either. The digest decides who gets blamed for a change,
  not whether one happened; the rendered output still moves, and the diff still
  catches it.
- **`provenanceOf` never guesses a component from the DOM.** Class names,
  `data-*` attributes and element structure are not consulted.

---

**[@variance-authority/react](https://variance-authority.dev/reference/packages/react)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
