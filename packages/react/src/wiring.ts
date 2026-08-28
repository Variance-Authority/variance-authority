import type { Wiring } from '@variance-authority/core';
import { FiberTag, findFiber, isOwnerFrame, type ContextDependency, type Fiber } from './fiber.js';

/**
 * Reading the framework's own account of a component, as a dimension.
 *
 * The rest of this package reads the fiber tree to answer *who is responsible*
 * for a node — provenance, owner chains, portal origins. This file reads it to
 * answer a different question: **what is this component, as distinct from what it
 * rendered.** Those separate, and the gap between them is where a whole class of
 * defect lives that no serializer of HTML and CSS can be made to see.
 *
 * The gap is concrete. Take a list rendered twice, once keyed by item id and once
 * keyed by array index. Both serialize to the same `<li>a</li><li>b</li>` — same
 * structure, same semantics, same text, same style, same boxes. One of them
 * survives a reorder with each row's state on the correct row and the other moves
 * every row's state onto its neighbour. That difference exists at the moment of
 * the still reading, it is fully determined, and it is in the fiber's `key` field
 * and nowhere else. A snapshot that omits it is not a snapshot with a gap in its
 * coverage; it is a snapshot that has recorded two different components as the
 * same component.
 *
 * ## The rule for what belongs here
 *
 * Wiring is hashed into a band, so it inherits the band contract: **read the same
 * page twice without changing anything, and the value must not move.** That rule
 * is what puts hook shape, wrapper identity, context subscriptions and
 * reconciliation keys in this file, and it is what keeps the fiber's most
 * valuable single fact — whether an instance remounted — out of it. Remounting is
 * a property of a reading rather than of a revision, so it lives in
 * `identity.ts` as a finding, where `pendingSuspense` lives. `wiring.test.tsx`
 * states the rule as an assertion rather than leaving it as a convention.
 *
 * ## Where a node gets its wiring
 *
 * Component-level facts (hooks, wrappers, contexts) attach to a component's
 * **root host node** and to no other node beneath it. The walk from a node's own
 * fiber stops at the first host fiber it meets: if it meets one before it meets a
 * composite, this node is nested inside another element and belongs to no
 * component directly, so it gets no component wiring.
 *
 * That is not an optimisation for wire size, though it is one. It is what makes
 * the band mean what it says. `shapeOf` folds every node a boundary owns, so
 * repeating a component's hook list on all forty of its descendants would make
 * the band's value depend on how many `<div>`s the component happens to render —
 * a wrapper element added for layout would change the "wiring" digest, which is a
 * lie about what wiring is.
 *
 * `key` is the exception and attaches to every node that has one, because it is a
 * fact about that node's own reconciliation rather than about its component.
 */

/**
 * Tags whose fiber corresponds to a node in the document.
 *
 * INTERNAL CONTRACT: the walk in {@link wiringOf} stops at these. If React adds a
 * host tag this set does not know, the symptom is a *deeper* node picking up its
 * enclosing component's wiring — over-attribution, which shows up as a wiring
 * band that moves when a layout wrapper is added, not as a crash.
 */
const HOST_TAGS: ReadonlySet<number> = new Set([
  FiberTag.HostRoot,
  FiberTag.HostComponent,
  FiberTag.HostText,
  FiberTag.HostPortal,
  FiberTag.HostHoistable,
  FiberTag.HostSingleton,
]);

/** Guards the `return` walk, like every other walk in this package. */
const MAX_FIBER_DEPTH = 10_000;

/** Bounds the context list walk against a cycle in `next`. */
const MAX_CONTEXTS = 256;

/**
 * How the framework holds the component that rendered this node.
 *
 * Returns `undefined` rather than an empty object when there is nothing to say,
 * so that a node under a framework this package cannot read is *absent* from the
 * band rather than carrying a digest of emptiness — the ADR-0002 distinction
 * between "no wiring" and "no reading", which the band relies on to avoid
 * claiming a plain-DOM page and a React page render alike.
 */
export function wiringOf(node: Node): Wiring | undefined {
  const own = findFiber(node);
  if (own === null) return undefined;

  const { component, key } = climb(own);

  const hooks = component === null ? undefined : hookNames(component);
  const wrappers = component === null ? undefined : wrappersOf(component);
  const contexts = component === null ? undefined : contextNames(component);

  // Undefined means *this node has no wiring to speak of*: not a component's
  // root and not carrying a key. An empty object means something else entirely —
  // a component was found here and it declares nothing, which for a component
  // with no hooks, no wrapper, no context and no key is the true answer.
  //
  // The two must not collapse. `instances.ts` treats a boundary of pure nulls as
  // unread and drops the band, so returning `undefined` for a plain component
  // would make a page this adapter read perfectly compare equal to a page it
  // could not read at all (ADR-0002) — and, worse, would give a component that
  // *lost* its `memo` the same digest as one that never had a framework.
  if (component === null && key === undefined) return undefined;

  return {
    ...(hooks ? { hooks } : {}),
    ...(wrappers ? { wrappers } : {}),
    ...(contexts ? { contexts } : {}),
    ...(key === undefined ? {} : { key }),
  };
}

/**
 * The composite fiber this node is the root output of, or null.
 *
 * Exported so that {@link wiringOf} and `holdingOf` place a boundary at exactly
 * the same node. They read different halves of one fiber — what the component
 * *is* and what it was *holding* — and the moment they disagreed about where a
 * component starts, a divergence would name a hook on a boundary the wiring band
 * says has none. One walk, stated once, is what stops that.
 */
export function componentFiberOf(node: Node): Fiber | null {
  const own = findFiber(node);
  return own === null ? null : climb(own).component;
}

/**
 * Walk from a node's own fiber up to the component it is the root output of,
 * collecting the reconciliation key on the way.
 *
 * One walk for both because the key is not reliably on either end. `<li key="a">`
 * puts it on the host fiber; `<Row key="r"/>` puts it on `Row`'s composite fiber;
 * `memo(forwardRef(Row))` with a key puts it on the `MemoComponent` wrapper above
 * that. All three are the same authored `key={...}` on the same element, so all
 * three have to reach the same field — reading `own.key` alone reports the first
 * and silently drops the other two, which is the shape of a band that quietly
 * stops noticing things.
 *
 * `component` is null in two situations that deliberately produce the same
 * answer: a node nested inside another element, and a node whose fiber chain
 * broke. Both mean "this node is not a component's root".
 */
function climb(own: Fiber): { component: Fiber | null; key: string | undefined } {
  let key = typeof own.key === 'string' ? own.key : undefined;
  let node = own.return;
  let component: Fiber | null = null;

  for (let depth = 0; depth < MAX_FIBER_DEPTH && node !== null; depth += 1) {
    if (HOST_TAGS.has(node.tag)) break;
    if (typeof node.key === 'string') key = node.key;

    if (component !== null) {
      // One step past the component, and only to pick up a `MemoComponent`
      // wrapper and the key it may carry. Climbing further would reach into the
      // *parent* component and report its key as this one's.
      break;
    }
    if (isOwnerFrame(node)) component = node;

    // Fragments, providers, Suspense and offscreen wrappers sit between a
    // component and its output without being either, so the walk passes through
    // them. A `<Suspense>` around a component's return value must not sever the
    // component from its own root node.
    node = node.return;
  }

  return { component, key };
}

/**
 * Hook names in call order, or undefined when React did not record them.
 *
 * Undefined covers two cases this cannot separate, and the conflation is stated
 * rather than papered over. React initialises `_debugHookTypes` to `null` and
 * only assigns an array once a hook actually runs, so a **hookless component in a
 * development build** reads exactly like a **production build**, where the field
 * is never populated at all.
 *
 * Absent for both, therefore, rather than `[]` for the first. That is the
 * conservative direction: a `[]` would be a positive claim that this component
 * declares no hooks, and the band would then report a real change — a component
 * that gained its first `useState` — as if it had merely become readable. An
 * absent field claims nothing and joins nothing (ADR-0002), which is the correct
 * answer when the observation cannot distinguish the two.
 */
function hookNames(fiber: Fiber): readonly string[] | undefined {
  const recorded = fiber._debugHookTypes;
  if (!Array.isArray(recorded) || recorded.length === 0) return undefined;
  return recorded.filter((name): name is string => typeof name === 'string');
}

/**
 * The wrapper chain around a component, outermost first.
 *
 * Reads the tags rather than the type objects. React collapses `memo(fn)` for a
 * plain function into a single `SimpleMemoComponent` fiber, and keeps a separate
 * `MemoComponent` wrapper fiber for every other case — so `memo(forwardRef(f))`
 * is a `14 → 11` pair and `memo(f, compare)` is `14 → 0`, both measured on
 * 19.2.8. Walking up through `MemoComponent` is what lets the second wrapper be
 * seen at all; `fiber.tag` alone would report `memo(forwardRef(f))` as a bare
 * `forwardRef`.
 */
function wrappersOf(fiber: Fiber): readonly ('memo' | 'forwardRef')[] | undefined {
  const found: ('memo' | 'forwardRef')[] = [];

  if (fiber.tag === FiberTag.SimpleMemoComponent) found.push('memo');
  if (fiber.tag === FiberTag.ForwardRef) found.push('forwardRef');

  // Exactly one level: `MemoComponent` is the only wrapper fiber React emits
  // above a composite, and a loop here would climb into the parent component.
  if (fiber.return?.tag === FiberTag.MemoComponent) found.unshift('memo');

  return found.length === 0 ? undefined : found;
}

/**
 * Context display names, sorted and deduplicated, or undefined when there are none.
 *
 * Sorted because the list is a *set* of subscriptions and its order is decided by
 * the order the component happened to call `useContext` in — reordering two
 * unrelated `useContext` calls changes nothing about the component, and a band
 * that moved on it would report a refactor as a change. Hook *order* is
 * load-bearing and is preserved in {@link hookNames}; subscription order is not.
 */
function contextNames(fiber: Fiber): readonly string[] | undefined {
  let link: ContextDependency | null | undefined = fiber.dependencies?.firstContext;
  if (!link) return undefined;

  const names = new Set<string>();
  for (let seen = 0; seen < MAX_CONTEXTS && link; seen += 1) {
    const displayName = link.context?.displayName;
    // Named `(anonymous)` rather than skipped: a subscription nobody named is
    // still a subscription, and dropping it would let a component that gained
    // one hash equal to one that has none.
    names.add(typeof displayName === 'string' && displayName !== '' ? displayName : '(anonymous)');
    link = link.next;
  }

  return names.size === 0 ? undefined : [...names].sort();
}
