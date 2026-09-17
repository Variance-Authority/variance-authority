# React evidence reference

`@variance-authority/react` reads metadata attached to DOM nodes by `react-dom`.
It does not render components, import the application's React package or require
the React DevTools hook. The subject must contain a live, client-mounted React
tree; static markup and unhydrated server output have no fiber to read.

A **subject** is one named UI state you capture and compare under an id you
choose — a route, a story, or a component mounted inside a test.

For the task-oriented path through these APIs, start with
[When React changes but the rendered page does not](framework.md).

```sh
npm install --save-dev @variance-authority/react
```

## React versions

This package declares no React dependency and imports nothing from React. It
reads the `__reactFiber$…` expando `react-dom` writes onto every host node it
creates, and the numeric work tags on the fiber behind it.

| React | Status |
|---|---|
| 19 | Exercised by this package's own suite |
| 18.3 | Exercised end to end, through a browser collector against a React 18 build |
| 17 | Read by the same path — same `__reactFiber$` expando, same work tags — and not exercised |
| 16 | Read through the older `__reactInternalInstance$` expando, and not exercised |

There is no version check and no compatibility shim, so 16 and 17 run the same
code 19 does. The risk on them is a field that is not populated yet rather than
a refusal. The work-tag numbers this reads have not moved since React 16, and
the expando prefix has not moved since 17.

What does move by version is call-site evidence, which is not part of wiring:
React 18 records `_debugSource`, and React 19 replaced it with a stack React
captures inside its own element factory.
[Attribution](attribution.md#what-each-build-already-knows) states what each
build carries.

```ts
import { detectReactRuntime } from '@variance-authority/react';

const root = document.querySelector('#app');
if (root !== null) detectReactRuntime(root);
// { keyFormat: 'reactFiber', majorHint: '>=17' }
// `version` is present only when a DevTools hook exposed one.
```

Nothing on a fiber carries a version number, so the exact version is available
only from a hook that may not exist. The expando format, the tag numbering and
the field names are React internals rather than public API, and can change in
any React release, including a patch.

## Availability by integration

| Surface | Wiring | Remount findings | Suspense arrival |
|---|---|---|---|
| Route collector | On by default; `wiring: false` disables it | Not collected | Waited and ruled on before capture |
| Storybook collector | On by default; `wiring: false` disables it | Not collected | Waited and ruled on before capture |
| Playwright test integration | On by default; `wiring: false` disables it | Not collected | Waited and ruled on before capture |
| Vitest Browser integration | On by default; `wiring: false` disables it | Not collected | Waited and ruled on before capture |
| `@variance-authority/dom` `collect` | Pass `wiringOf` explicitly | Not collected | Caller-owned |
| `@variance-authority/unit-test` capture | Pass `wiringOf` explicitly | Not collected | Caller-owned |
| `@variance-authority/react` direct API | Call `wiringOf` | Call `markRender` and `remountedSince` | Call `awaitSuspense` and `suspenseRefusal` |

Remounts are not a field a one-shot collector can infer. The mark belongs before
the action chosen by the test, while collection sees only the state after that
action.

`wiring` is a top-level key of the integration's own options object, beside the
rest of its configuration. For the route collector:

```js
// variance/routes.mjs
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: { 'checkout/empty': 'http://localhost:3000/checkout' },
  roots: ['#app'],
  wiring: false,
});
```

The Storybook collector takes the same key in `storybookCollector({ … })`, the
Playwright integration in the options argument to `observe`, and the Vitest
Browser integration in the second argument to `variance`. Leave it out and
wiring is read.

## `wiringOf`

```ts
function wiringOf(node: Node): Wiring | undefined
```

`wiringOf` describes how React holds the component whose root output is `node`.
Component-level fields attach only to that component's root host node. A
reconciliation key may attach to any node that carries one.

```ts
interface Wiring {
  readonly hooks?: readonly string[];
  readonly wrappers?: readonly ('memo' | 'forwardRef')[];
  readonly contexts?: readonly string[];
  readonly key?: string;
}
```

| Field | Meaning | Ordering |
|---|---|---|
| `hooks` | Hook names React recorded, without their values | Call order |
| `wrappers` | Authored `memo` and `forwardRef` wrappers | Outermost first |
| `contexts` | Subscribed context display names; anonymous contexts use `(anonymous)` | Sorted and deduplicated |
| `key` | The reconciliation key React assigned to the node or component boundary | One value |

The result is `undefined` when no readable fiber or relevant component boundary
is available. `{}` is different: the component boundary was read and carries no
observable hooks, wrappers, contexts or key. That distinction keeps “nothing
observed” from becoming evidence that the component has empty wiring.

### Reading it

Pass a mounted DOM node and read the fields you are asserting on. The call is
synchronous, and unlike the commit tap below it does not have to be loaded ahead
of `react-dom`.

```ts
import { expect, test } from 'vitest';
import { wiringOf } from '@variance-authority/react';

test('row 3 is keyed by its item id', () => {
  const row = document.querySelector('[data-testid="row-3"]');
  if (row === null) throw new Error('row-3 did not mount');

  const wiring = wiringOf(row);

  // A list keyed by array position rather than by item id: a reorder moves each
  // row's state onto its neighbour, and both orders serialize identically.
  expect(wiring?.key).not.toBe('2');

  // A `memo` that a refactor dropped. The document is unchanged either way.
  expect(wiring?.wrappers ?? []).toContain('memo');

  // What this node subscribed to, sorted and deduplicated.
  expect(wiring?.contexts ?? []).toEqual(['ThemeContext']);
});
```

`wiring` is `undefined` for a node React did not render and for a node nested
inside another element rather than being a component's own root, so read it with
`?.` unless you have already established which of the two you have.

### What the wiring digest means

A captured component boundary carries separate digests for structure, semantics,
text, style, optional geometry and optional wiring. Wiring is a digest of its
own, outside the rendering digest, whose meaning remains “the same rendered
content.” Adding `memo`, changing a context subscription or changing a key does
not become a visual regression, and enabling the reader does not change the
stored content digests.

Hook values never enter wiring. A timer, animation frame or state cell may move
between two valid readings of one revision; hashing that value would make the
observer generate the change it claims to detect. Values that help explain a
rendering belong to [`holdingOf`](parting.md#what-it-reads), as evidence outside
every hash.

React records hook names only after a hook runs. A hookless component in a
development build and a component in a production build are therefore
indistinguishable through this field, so `hooks` is absent for both. The reader
does not replace that uncertainty with an empty list.

## `markRender` and `remountedSince`

```ts
function markRender(root: Element): RenderMark
function remountedSince(root: Element, mark: RenderMark): readonly Remount[]

interface Remount {
  readonly name: string;
  readonly owners: readonly string[];
  readonly key?: string;
  readonly element: Element;
}
```

Take the mark after the subject has mounted and before the action being
investigated. `remountedSince` then returns component instances that occupied an
existing position at mark time and were rebuilt during the interval. A component
appearing for the first time is not a remount, and a subtree that did not commit
is not reported.

Results are in document order. When several component boundaries share one host
element, the outermost rebuilt component comes first so the likely cause precedes
the components rebuilt with it. `owners` is innermost first and identifies the
enclosing component path. `element` is the host element around which the
component was rebuilt.

A `key` is reported rather than used as a filter. A changed key is React's normal
request for a fresh instance; whether it was supposed to change for the action
you performed is yours to decide. An absent key means no reconciliation key
requested the rebuild.

### Matching boundary

Instances across the interval match by component name, fiber depth and ordinal
among components with the same name and depth. Fiber identity cannot be the
match key because a remount replaces that identity, and component function
identity cannot be the key because a component declared inside another function
receives a new function on every parent render.

Two unkeyed siblings with the same component name at the same depth can be
confused when one is removed and another is added. Read that result together
with the recorded reconciliation keys; an unkeyed list is already missing the
identity React would need to distinguish those siblings reliably.

### Why remounts are not wiring

Wiring is stable when the same revision is read twice. A remount exists only in
relation to an earlier instance and has no useful value on an initial mount.
Folding it into wiring would make an unchanged page produce a different digest
merely because it was read again. The two-call API keeps the temporal boundary
explicit.

An update preserves component state, focus, subtree scroll, uncontrolled input
values and in-flight effects. A remount resets or restarts them. The rendered
document can be byte-identical after either path.

## In a minified production build

The expando, the work tags, the reconciliation key and the `alternate` pointer
these readers depend on are all present in a production build, so `wiringOf`,
`markRender` and `remountedSince` run there. Two things degrade: the fields
React records only for a development build, and the component names a bundler
renamed.

| Field | In a minified production build |
|---|---|
| `Wiring.hooks` | Absent. React populates the hook-name list in a development build only |
| `Wiring.wrappers` | Read from fiber tags rather than names. Unaffected |
| `Wiring.contexts` | Read from the fiber's context-dependency list, which React populates in any build. The names are the `displayName` strings you assigned, and a context you never named reads `(anonymous)` in either build |
| `Wiring.key` | A runtime value from `key={…}`. Unaffected |
| `Remount.name` and `Remount.owners` | The bundler's identifier: `Ce` rather than `Button`. The commit tap names components the same way |
| `Remount.key` and `Remount.element` | Unaffected |

Renamed components do not break remount matching. `markRender` and
`remountedSince` are called within one page session against one build, so both
sides carry the same renamed identifier and the match by name, depth and ordinal
still holds. What you lose is a name you can act on, not the finding.

To get authored names out of a built bundle, keep them in the build. Vite 8
spells the setting `build.rolldownOptions.output.keepNames`; Vite 7 and below
spell it `esbuild.keepNames`. Resolving a changed element to the line it is
written on is a separate purchase — see
[attribution](attribution.md#what-each-build-already-knows).

## Related React evidence

Each of these is exported from `@variance-authority/react`.

```ts
function holdingOf(node: Node): Holding | undefined
function awaitSuspense(node: Node, options?: SuspenseWaitOptions): Promise<SuspenseSettlement>
function suspenseRefusal(
  settlement: SuspenseSettlement,
  declaration?: LoadingDeclaration,
): string | undefined
function tapCommits(options?: TapOptions): CommitTap
function awaitQuiet(tap: CommitTap, options?: QuietOptions): Promise<QuietResult>
function provenanceOf(node: Node, declared?: DeclarationSink, pass?: DigestPass): Provenance | undefined
```

| API | Contract | Route |
|---|---|---|
| `holdingOf` | Props, contexts and hook cells as one-way digests; never identity | [Where two readings parted](parting.md) |
| `awaitSuspense` | `settled`, `pending` or `unobserved`; default wait is 5000 ms with two clean confirmations when boundaries exist | [Holding a page still](stabilization.md#pendingsuspense--the-boundary-that-has-not-arrived-by-name) |
| `suspenseRefusal` | A refusal sentence or `undefined`, with a symmetric declaration for intentional loading-state captures | [The wait and the decision](stabilization.md#the-wait-and-the-decision-it-forces) |
| `tapCommits` / `awaitQuiet` | Components performing work and a bounded quiet wait | [The commit tap](stabilization.md#tapcommits--which-components-rendered-and-when-they-stopped) |
| `provenanceOf` | Owner and author chains, props digests, portals and available call-site evidence | [From a pixel to a line](attribution.md) |

The commit tap must be installed before `react-dom` loads: it works by owning
React's renderer hook, and `react-dom` reads that hook once, when its module body
runs. Call `tapCommits` from a file that runs ahead of the module importing
`react-dom` — a runner setup file loaded before the suite, or a browser init
script evaluated before the page's own scripts.

```ts
// a setup file the runner loads before the suite
import { tapCommits } from '@variance-authority/react';

export const tap = tapCommits();
```

An integration that arrives at an already-loaded page cannot honestly claim that
it heard every commit, so a late tap refuses instead of reporting a quiet page.
The refusal is a value rather than a throw: `tap.attached` is `false` and
`tap.reason` is `react-already-loaded`, `unrecognised-hook` or `no-hook`. Read
`attached` before reading `commits()`, because no commits and nobody listening
look identical otherwise.

## Limits

- These readers support React DOM fibers. They do not generalize React evidence
  to another renderer or framework.
- `wiringOf` reads hook names in development builds, not hook values. A
  production build leaves them unavailable; the rest of `Wiring` survives it.
- A remount names the rebuilt component, its owner chain, key and host element.
  It does not recover which parent update caused the rebuild or attribute it to
  a source line.
- No collector emits remount findings automatically. The test or harness that
  owns the action also owns the mark and the decision about the result.
- A node that React did not render produces no framework evidence. The reader
  does not infer a component from its tag, class or position in the DOM.
