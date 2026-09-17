# React evidence reference

[Variance Authority](README.md) is a visual regression system you run yourself:
it renders a UI state, compares it against the baseline you approved, and
reports what changed in the vocabulary of your source.
`@variance-authority/react` is the part that reads React's own record of a page,
so a comparison can report differences the rendered document does not contain —
a dropped `memo`, a list keyed by array position, a component rebuilt where it
should have been updated.

This page is the contract: return shapes, collector defaults, and what React's
internals do and do not expose. For the task-oriented path through the same
APIs, start with
[When React changes but the rendered page does not](framework.md).

A **subject** is one named UI state you capture and compare under an id you
choose — a route, a story, or a component mounted inside a test.

Every reader here goes through a **fiber**: the object `react-dom` keeps for
each element it rendered, holding the component behind that element, its hooks,
its context subscriptions, its reconciliation key and its place in the tree. The
package reads those objects directly. It does not render components, import your
React package or require the React DevTools hook. A subject must contain a live,
client-mounted React tree; static markup and unhydrated server output have no
fiber to read.

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
| 18.3, 17 | Read by the same path — same `__reactFiber$` expando, same work tags — and not exercised |
| 16 | Read through the older `__reactInternalInstance$` expando, and not exercised |

There is no version check and no compatibility shim, so 16, 17 and 18 run the same
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

`detectReactRuntime(node?, scope?)` returns a `ReactRuntimeInfo`:
`keyFormat` is the expando convention observed on the node (`reactFiber` or
`reactInternalInstance`), `majorHint` is the version bound that convention
implies, and `version` is the exact `react-dom` version, present only when a
DevTools hook exposed one. Nothing on a fiber carries a version number, so the
exact version is available only from a hook that may not exist. The expando
format, the tag numbering and the field names are React internals rather than
public API, and can change in any React release, including a patch.

## What a wiring change gets you

Wiring — hooks, `memo` and `forwardRef` wrappers, context subscriptions,
reconciliation keys — sits outside the four content digests a subject is
compared on (structure, semantics, text and style). A component that gained a
`memo` or changed a key produces no pixel difference, no band, and no
re-baselining of the subject.

What it does change is the subject's **tree signature**: the owner chain plus
the wiring at every node that carries one, in document order. A comparison of
two full captures reads that signature and leads its output with a slice — a
one-line triage verdict for the whole comparison, printed before anything about
which property moved:

| What you did | The line the comparison prints |
|---|---|
| Rewrote the components, page unchanged | `refactor — the component tree changed and the page did not` |
| Tree is a different tree and the page followed, with every input agreeing | `reshaped — the component tree is a different tree and the page followed` |
| Nothing moved at all | `settled — the component tree, its inputs and its output all held` |

So a wiring-only edit hands you `refactor`: the screenshots match, which is all
a pixel differ can tell you, and the components underneath are confirmed
rewritten. Wrap a subtree in a new `Panel` and the tree signature is what
notices. [Parting](parting.md#the-slice-what-kind-of-parting-this-is) lists all
eight slices and what decides between them.

Two things stay out of that signature on purpose. Hook *values* — a timer, an
animation frame, a state cell — move between two valid readings of one revision,
so they are digested only as one-way evidence by
[`holdingOf`](parting.md#what-it-reads), outside every hash. And remounts,
which are a property of an interval rather than of a revision, are a finding you
ask for around an action rather than part of any digest.

## Availability by integration

| Surface | Wiring | Remount findings | Suspense arrival |
|---|---|---|---|
| Route collector | On by default; `wiring: false` disables it | Not collected | Waited and ruled on before capture |
| Storybook collector | On by default; `wiring: false` disables it | Not collected | Waited and ruled on before capture |
| Playwright test integration | On by default; `wiring: false` disables it | Not collected | Waited and ruled on before capture |
| Vitest Browser integration | On by default; `wiring: false` disables it | Not collected | Waited and ruled on before capture |
| `@variance-authority/dom` `collect` | Pass `wiringOf` explicitly | Not collected | Caller-owned |
| `@variance-authority/unit-test` `capture` | Pass `wiringOf` explicitly | Not collected | Caller-owned |
| `@variance-authority/react` direct API | Call `wiringOf` | Call `markRender` and `remountedSince` | Call `awaitSuspense` and `suspenseRefusal` |

No collector emits remount findings. The mark has to be taken before the action
being investigated, and a collector sees only the state after it.

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
Playwright integration in the options argument to `observe` from
`@variance-authority/playwright-test`, and the Vitest Browser integration in the
second argument to `variance` from `@variance-authority/vitest-browser`. Leave
it out and wiring is read.

The two lower-level surfaces take the reader function itself rather than a
boolean, because they do not choose a framework for you:

```ts
import { collect } from '@variance-authority/dom';
import { capture } from '@variance-authority/unit-test';
import { provenanceOf, wiringOf } from '@variance-authority/react';

const viewport = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' } as const;

collect(root, {
  subject: { id: 'checkout/empty', kind: 'fixture' },
  viewport,
  engine: 'chromium',
  provenanceOf,
  wiringOf,
});

await capture(root, { subject: 'checkout/empty', viewport, provenanceOf, wiringOf });
```

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
observable hooks, wrappers, contexts or key. Read the two apart before asserting
on an empty result — only `{}` is evidence about the component.

`hooks` is absent, never `[]`, when React recorded no names. React records a
hook name only after that hook runs, so a component that declares none and a
component in a production build reach this field the same way.

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

## `markRender` and `remountedSince`

An update preserves component state, focus, subtree scroll, uncontrolled input
values and in-flight effects. A remount resets or restarts them, and the
rendered document can be byte-identical after either path. These two calls tell
the two apart across an interval you choose.

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

```ts
import { markRender, remountedSince } from '@variance-authority/react';

const subject = document.querySelector('[data-subject]');
if (subject === null) throw new Error('subject did not mount');

const mark = markRender(subject);
// …perform the action being investigated…
const rebuilt = remountedSince(subject, mark);
```

`RenderMark` is an opaque record of the instances present at mark time; you pass
it back and read nothing off it. Take the mark after the subject has mounted and
before the action being investigated. `remountedSince` then returns component
instances that occupied an existing position at mark time and were rebuilt
during the interval. A component appearing for the first time is not a remount,
and a subtree that did not commit is not reported.

Results are in document order. When several component boundaries share one host
element, the outermost rebuilt component comes first so the likely cause precedes
the components rebuilt with it. `owners` is innermost first and identifies the
enclosing component path. `element` is the host element around which the
component was rebuilt.

A `key` is reported rather than used as a filter. A changed key is React's normal
request for a fresh instance; whether it was supposed to change for the action
you performed is yours to decide. An absent key means no reconciliation key
requested the rebuild.

[When React changes but the rendered page does not](framework.md#remounts-what-the-document-cannot-show-you)
carries a complete Vitest test built around this pair.

### Matching boundary

Instances across the interval match by component name, fiber depth and ordinal
among components with the same name and depth — not by fiber identity, which a
remount replaces, and not by component function identity, which moves on every
parent render for a component declared inside another function.

Two unkeyed siblings with the same component name at the same depth can
therefore be confused when one is removed and another is added. Read that result
together with the recorded reconciliation keys; an unkeyed list is already
missing the identity React would need to distinguish those siblings.

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
still holds. What degrades is the name you read, not the finding.

To get authored names out of a built bundle, keep them in the build. Vite 8
spells the setting `build.rolldownOptions.output.keepNames`; Vite 7 and below
spell it `esbuild.keepNames`. Resolving a changed element to the line it is
written on is a separate purchase — see
[attribution](attribution.md#what-each-build-already-knows).

## Related React evidence

Each of these is exported from `@variance-authority/react`. A `Digest` anywhere
below is a string of the form `v1:<32 hex characters>` — a one-way hash you can
compare but not read a value back out of.

### `holdingOf`

```ts
function holdingOf(node: Node): Holding | undefined
```

What the component behind `node` was handed and what it retained, as digests
rather than values.

```ts
import { holdingOf } from '@variance-authority/react';

const held = holdingOf(document.querySelector('[data-testid="row-3"]')!);
```

| `Holding` field | Holds |
|---|---|
| `cells?: readonly HeldCell[]` | One entry per hook that retains something, in authored call order |
| `contexts?: readonly HeldValue[]` | Context values this boundary read, by the context's display name, sorted |
| `props?: readonly HeldValue[]` | The props object, one entry per key, sorted, with `children` excluded |
| `unread?: string` | The name of a hook this reader does not know. Its presence means `cells` is a prefix, not the whole list |

`HeldCell` is `{ index: number; hook: string; digest: Digest }` — `index` is the
position you reach by counting hook calls down the component, and indexes
`Wiring.hooks` exactly. `HeldValue` is `{ name: string; digest: Digest }`.

Route: [Where two readings parted](parting.md).

### `awaitSuspense` and `suspenseRefusal`

```ts
function awaitSuspense(node: Node, options?: SuspenseWaitOptions): Promise<SuspenseSettlement>
function suspenseRefusal(
  settlement: SuspenseSettlement,
  declaration?: LoadingDeclaration,
): string | undefined
```

```ts
import { awaitSuspense, suspenseRefusal } from '@variance-authority/react';

const settlement = await awaitSuspense(root);
const refusal = suspenseRefusal(settlement, { subjectId: 'checkout/empty' });
if (refusal !== undefined) throw new Error(refusal);
```

`SuspenseWaitOptions` is `{ timeoutMs?, pollMs?, confirmations? }`: give up after
`timeoutMs` (default 5000; `0` means read once and wait for nothing), re-read
every `pollMs` (default 16), and require `confirmations` consecutive clean reads
before calling a subtree settled (default 2, which is what stops a capture
landing in the gap between one fallback leaving and the next arriving).

`SuspenseSettlement` is `{ outcome, waitedMs, boundaries, pending }`. `outcome`
is `settled` (nothing was waiting), `pending` (something was still waiting when
the wait ran out) or `unobserved` (no fiber at or under the node, so nobody
looked). `boundaries` counts the Suspense boundaries found in the subtree in any
state; `pending` lists the ones still waiting, each a `SuspenseBoundary`:
`state` (`resolved`, `pending` or `dehydrated`), `owners` (the components
enclosing it, innermost first — a `<Suspense>` has no name of its own), an
optional `createdBy` and `key`, and `depth`, the number of boundaries enclosing
it.

`LoadingDeclaration` is `{ declaredLoading?: boolean; subjectId?: string }`. Set
`declaredLoading` when the subject is deliberately a capture of its loading
state, which inverts the decision; `subjectId` is named in the returned sentence.
`suspenseRefusal` returns that sentence, or `undefined` when the subject may be
recorded.

Route:
[Holding a page still](stabilization.md#pendingsuspense--the-boundary-that-has-not-arrived-by-name)
and [the wait and the decision](stabilization.md#the-wait-and-the-decision-it-forces).

### `tapCommits` and `awaitQuiet`

```ts
function tapCommits(options?: TapOptions): CommitTap
function awaitQuiet(tap: CommitTap, options?: QuietOptions): Promise<QuietResult>
```

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

```ts
import { awaitQuiet } from '@variance-authority/react';
import { tap } from './setup.js';

const quiet = await awaitQuiet(tap, { quietFor: 100, timeout: 2_000 });
```

`CommitTap` carries `attached` (false when nothing was instrumented),
`reason` (why not), `reactVersion` when a renderer has injected one, and four
methods: `commits()` for the retained commits oldest first, `dropped()` for how
many the retention bound discarded, `quietFor()` for milliseconds since the last
commit, and `stop()` to restore whatever was there before. Read `attached` before
reading `commits()` — no commits and nobody listening look identical otherwise.
`reason` is `react-already-loaded`, `unrecognised-hook` or `no-hook`. An
integration arriving at an already-loaded page gets a refusal as a value rather
than a throw, so a late tap never reports a quiet page.

Each `Commit` is `{ at, components, updaters?, truncated?, updatersTruncated? }`:
`at` in milliseconds since the tap attached, `components` the composite
components that rendered in that commit outermost first (host elements excluded,
so an empty list means React committed something no component re-rendered for),
`updaters` the fibers that initiated it when React exposed them, and the two
flags set when a retention limit cut a list short.

`TapOptions` is `{ scope?, nameLimit?, updaterLimit?, keep?, onCommit?,
refuseIfLoaded?, createHook? }`. `keep` bounds retained commits (default 512);
`updaterLimit` bounds initiators per commit (default 64); `onCommit` observes
each retained commit synchronously; `refuseIfLoaded` (default true) decides
whether an already-mounted page is a refusal; `createHook` (default true) decides
whether a missing hook may be installed, and a caller that cannot promise it ran
first passes `false` and reads `no-hook`; `scope` substitutes the global the hook
lives on.

`QuietOptions` is `{ quietFor?, timeout?, interval? }` — milliseconds of silence
that count as settled (default 100), how long to wait before giving up (default
2000), and the poll interval (default 16). `QuietResult` is
`{ settled, quietFor, commits, restless }`: whether the page went quiet, how long
it was quiet for, how many commits were observed while waiting, and `restless`,
the components that rendered while waiting as `{ name, commits }`, most commits
first.

Route: [the commit tap](stabilization.md#tapcommits--which-components-rendered-and-when-they-stopped).

### `provenanceOf`

```ts
function provenanceOf(node: Node, declared?: DeclarationSink, pass?: DigestPass): Provenance | undefined
```

```ts
import { provenanceOf } from '@variance-authority/react';

const provenance = provenanceOf(document.querySelector('[data-testid="row-3"]')!);
```

`Provenance` is `{ owners, createdBy?, source?, stack? }`. `owners` is the
composite components enclosing the node, innermost first, each an `OwnerFrame`:
`name` (`displayName`, then function name, then `Anonymous`), `propsDigest` (a
`Digest` of that boundary's serializable props), and an optional `createdBy`
naming the component whose JSX placed it. `Provenance.createdBy` names the
component whose JSX created the host node itself, which is a different question
from which component encloses it. `source` is a `{ file, line, column }`, present
when a compiler plugin is installed. `stack` is transient call-site evidence
awaiting a source map, and never reaches a digest or a baseline.

The two optional arguments are collector plumbing and a direct caller passes
neither: `DeclarationSink` is `{ note(fiber) }`, a registry a collector fills so
a component can be named by the function that declared it, and `DigestPass` is a
`WeakMap` of props object to `Digest`, reused across the nodes of one capture.

Route: [From a pixel to a line](attribution.md).

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
