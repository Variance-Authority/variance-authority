# React evidence reference

`@variance-authority/react` reads metadata attached to DOM nodes by `react-dom`.
It does not render components, import the application's React package or require
the React DevTools hook. The subject must contain a live, client-mounted React
tree; static markup and unhydrated server output have no fiber to read.

For the task-oriented path through these APIs, start with
[When React changes but the rendered page does not](framework.md).

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

### What the wiring digest means

`componentInstances(snapshot)` projects each component boundary into separate
digests for structure, semantics, text, style, optional geometry and optional
wiring. Wiring is outside `rendering`, whose meaning remains “the same rendered
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
request for a fresh instance, but whether it was supposed to change belongs to
the caller's scenario. An absent key means no reconciliation key requested the
rebuild.

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

## Related React evidence

| API | Contract | Route |
|---|---|---|
| `holdingOf` | Props, contexts and hook cells as one-way digests; never identity | [Where two readings parted](parting.md) |
| `awaitSuspense` | `settled`, `pending` or `unobserved`; default wait is 5000 ms with two clean confirmations when boundaries exist | [Holding a page still](stabilization.md#pendingsuspense--the-boundary-that-has-not-arrived-by-name) |
| `suspenseRefusal` | A refusal sentence or `undefined`, with a symmetric declaration for intentional loading-state captures | [The wait and the decision](stabilization.md#the-wait-and-the-decision-it-forces) |
| `tapCommits` / `awaitQuiet` | Components performing work and a bounded quiet wait | [The commit tap](stabilization.md#tapcommits--which-components-rendered-and-when-they-stopped) |
| `provenanceOf` | Owner and author chains, props digests, portals and available call-site evidence | [From a pixel to a line](attribution.md) |

The commit tap must be installed before `react-dom` loads. An integration that
arrives at an already-loaded page cannot honestly claim that it heard every
commit, so a late tap refuses instead of reporting a quiet page.

## Limits

- These readers support React DOM fibers. They do not generalize React evidence
  to another renderer or framework.
- `wiringOf` reads hook names in development builds, not hook values. Production
  React normally leaves hook names unavailable.
- A remount names the rebuilt component, its owner chain, key and host element.
  It does not recover which parent update caused the rebuild or attribute it to
  a source line.
- No collector emits remount findings automatically. The test or harness that
  owns the action also owns the mark and the decision about the result.
- A node that React did not render produces no framework evidence. The reader
  does not infer a component from its tag, class or position in the DOM.
