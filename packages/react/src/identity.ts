import { FiberTag, findFiber, isOwnerFrame, type Fiber } from './fiber.js';
import { fiberComponentName } from './names.js';

/**
 * Whether a component instance survived, or was destroyed and rebuilt.
 *
 * This is the fiber's most valuable single fact and the one furthest out of reach
 * of every other instrument in this project. React can respond to a parent's
 * re-render in two ways. It can *update* a child — keep the fiber, keep its
 * hooks, keep its state, keep the DOM node and patch it. Or it can *remount* —
 * tear the subtree down and build a new one. The two produce the same document.
 * Not a similar one: the same one. Every band agrees, every pixel agrees, the
 * accessibility tree agrees.
 *
 * What differs is everything the user had:
 *
 * | | update | remount |
 * |---|---|---|
 * | `useState` | kept | reset to its initial value |
 * | focus | kept | lost to `<body>` |
 * | scroll position of a subtree | kept | reset |
 * | an uncontrolled `<input>` | kept | emptied |
 * | a CSS transition in flight | continues | restarts |
 * | `useEffect` with `[]` | does not re-run | runs again, and its cleanup fires |
 *
 * Measured, in `identity.test.tsx`: a counter clicked to 1 reads `1` after its
 * parent re-renders when the child is a stable component, and `0` when the child
 * is declared inside the parent's body. The second is the single most common way
 * to write this bug and the second component renders identically to the first.
 *
 * ## How it is read
 *
 * React double-buffers. Every fiber that has been through a commit *as an update*
 * has an `alternate` — its counterpart in the other tree. A fiber created during
 * the current commit has none. So `alternate === null`, read after a commit that
 * was not the page's first, means *this instance was built just now*, which for a
 * component that was already on screen means it was rebuilt.
 *
 * The qualifier is the whole reason this takes a `since` argument. After the very
 * first commit every fiber on the page has `alternate === null`, correctly and
 * uninterestingly. Reading remounts against a mount would report the entire page.
 *
 * ## Deliberate and accidental remounts look identical
 *
 * `<Row key={id} />` with a changing `id` is a remount the author asked for, and
 * it has the same `alternate === null` as the accidental kind (measured). The
 * fiber's `key` is what separates them, so it is reported rather than filtered
 * on: a remount under a key is a decision, a remount with no key is a defect, and
 * this file states which it saw rather than deciding for the reader.
 */

/** One component instance that was rebuilt rather than updated. */
export interface Remount {
  /** The component that was rebuilt. */
  readonly name: string;

  /** Enclosing components, innermost first. Where to go and look. */
  readonly owners: readonly string[];

  /**
   * The reconciliation key React held it under, when it had one.
   *
   * Present means somebody wrote `key={...}` here and the key changed, so the
   * remount was asked for. Absent means nothing asked for it — which is the case
   * worth reporting, and the reason this is a field rather than a filter.
   */
  readonly key?: string;

  /** The host element it rebuilt around, for pointing at. */
  readonly element: Element;
}

/**
 * What an instance was, recorded at mark time.
 *
 * Recorded rather than recomputed, and that is not a cache. React *detaches* a
 * torn-down fiber — `detachFiberMutation` nulls its `return` — so by the time
 * anyone asks whether the old thing matched the new thing, the old thing no
 * longer knows where it was. Measured: a depth computed from a detached fiber is
 * always zero, and a comparison against it silently matches nothing, which
 * reports a page full of remounts as a page with none.
 */
interface InstanceKey {
  readonly name: string;
  readonly depth: number;

  /**
   * Which occurrence of this `name` at this `depth`, in document order.
   *
   * Not the reconciliation key, and deliberately so. A changed `key` is one of
   * the two ways a remount happens, so an identity that included it would fail
   * to match precisely the case it most needs to recognise — the keyed remount
   * would look like one instance vanishing and an unrelated one arriving, and
   * the finding would be dropped for being about two different things.
   */
  readonly ordinal: number;
}

/**
 * A marker for "the page had already committed once", taken before the change.
 *
 * Opaque because its only correct use is to be passed straight back into
 * {@link remountedSince}. It exists so that the mount/remount distinction is
 * something a caller cannot forget to make — the alternative is a `remounted()`
 * that silently reports every component on a freshly mounted page.
 */
export interface RenderMark {
  /**
   * Fiber identity, weakly. A `Set` here would be a strong reference into
   * React's tree, so a mark held across a page's lifetime would pin every
   * torn-down subtree in memory — and pinning the very subtrees this file exists
   * to report is a memory leak with a sense of humour.
   */
  readonly seen: WeakSet<Fiber>;

  /** What stood where, at mark time. */
  readonly instances: readonly InstanceKey[];
}

/**
 * Record which component instances exist now, before doing whatever you are
 * about to do.
 */
export function markRender(root: Element): RenderMark {
  const seen = new WeakSet<Fiber>();
  const instances: InstanceKey[] = [];
  for (const found of instancesIn(root)) {
    seen.add(found.fiber);
    instances.push(found.identity);
  }
  return { seen, instances };
}

/**
 * Component instances rebuilt since the mark, in document order.
 *
 * The test is deliberately two-sided. `alternate === null` says the fiber was
 * created in the latest commit; absence from the mark says it is not simply a
 * component that has appeared for the first time. A newly *added* row is not a
 * remount and reporting it as one would bury the real finding under every list
 * insertion on the page.
 */
export function remountedSince(root: Element, mark: RenderMark): readonly Remount[] {
  const found: Remount[] = [];

  for (const { element, fiber, identity } of instancesIn(root)) {
    if (fiber.alternate !== null) continue;

    // The same object as before: it has not been through a commit since the mark
    // at all. Common and uninteresting — a subtree that bailed out keeps its
    // fiber and never acquires an alternate, so identity has to be checked
    // before shape or every quiet component on the page reads as rebuilt.
    if (mark.seen.has(fiber)) continue;

    // A different object standing where one stood before. A component appearing
    // for the first time matches nothing in the mark and is not a remount.
    if (!mark.instances.some((before) => sameInstance(before, identity))) continue;

    const owners = ownerNames(fiber.return);
    const key = typeof fiber.key === 'string' ? fiber.key : undefined;
    found.push({
      name: fiberComponentName(fiber),
      owners,
      ...(key === undefined ? {} : { key }),
      element,
    });
  }

  return found;
}

/**
 * Whether two records from different commits denote the same authored instance.
 *
 * Position, key and *name*, deliberately not type identity. The fiber objects
 * differ — that is the finding — and so does `type`, on every inline component,
 * which is the defect this whole file exists for. Comparing `type` would
 * therefore classify the interesting case as "a different component appeared"
 * and report nothing at all.
 *
 * The remaining ambiguity is real and is stated rather than hidden: two unkeyed
 * siblings of one component at one depth, where one is removed and another
 * added, will match. That is a list without keys, which {@link Wiring} reports
 * separately, and the two findings are meant to be read together.
 */
function sameInstance(before: InstanceKey, after: InstanceKey): boolean {
  return (
    before.name === after.name &&
    before.depth === after.depth &&
    before.ordinal === after.ordinal
  );
}

function depthOf(fiber: Fiber): number {
  let depth = 0;
  let node = fiber.return;
  for (; node !== null && depth < MAX_FIBER_DEPTH; depth += 1) node = node.return;
  return depth;
}

const MAX_FIBER_DEPTH = 10_000;

interface Instance {
  readonly element: Element;
  readonly fiber: Fiber;
  readonly identity: InstanceKey;
}

/**
 * Every component instance under `root`, in document order, with its identity.
 *
 * Walks the document rather than the fiber tree, and does so on purpose: the
 * caller has an `Element` for a subject and wants findings inside it, and a fiber
 * walk from a root would cross out of the subject and report the whole page.
 *
 * Each element yields *every* composite between it and the first host fiber
 * above, not only the nearest. A component that renders nothing but another
 * component — `InnerRow` returning `<Counter/>` — owns no host node of its own,
 * and stopping at the nearest composite would leave it out of the walk entirely.
 * It is also the component the author wrote and the one whose remount explains
 * the others, so a report that named only `Counter` would point at the symptom.
 */
function instancesIn(root: Element): readonly Instance[] {
  const found: Instance[] = [];
  const counts = new Map<string, number>();

  const walk = (element: Element): void => {
    const own = findFiber(element);
    if (own !== null) {
      for (const fiber of componentsAbove(own)) {
        const name = fiberComponentName(fiber);
        const depth = depthOf(fiber);
        const slot = `${name}@${String(depth)}`;
        const ordinal = counts.get(slot) ?? 0;
        counts.set(slot, ordinal + 1);
        found.push({ element, fiber, identity: { name, depth, ordinal } });
      }
    }
    for (const child of element.children) walk(child);
  };
  walk(root);

  return found;
}

/**
 * Composites between this element's fiber and the first host above it, **outermost
 * first** — the reverse of the walk, and of the `owners` convention.
 *
 * `owners` is innermost-first because it answers "where is this node", and the
 * answer starts at the node. This list answers "what happened here", and when a
 * component is rebuilt everything it renders is rebuilt with it. The outermost
 * one is the cause and the rest are its collateral, so putting the cause first is
 * what makes `remounted[0]` the line worth reading.
 */
function componentsAbove(own: Fiber): readonly Fiber[] {
  const found: Fiber[] = [];
  let node = own.return;
  for (let depth = 0; depth < MAX_FIBER_DEPTH && node !== null; depth += 1) {
    if (HOST_TAGS.has(node.tag)) break;
    if (isOwnerFrame(node)) found.unshift(node);
    node = node.return;
  }
  return found;
}

const HOST_TAGS: ReadonlySet<number> = new Set([
  FiberTag.HostRoot,
  FiberTag.HostComponent,
  FiberTag.HostText,
  FiberTag.HostPortal,
  FiberTag.HostHoistable,
  FiberTag.HostSingleton,
]);

function ownerNames(from: Fiber | null): readonly string[] {
  const names: string[] = [];
  let node = from;
  for (let depth = 0; depth < MAX_FIBER_DEPTH && node !== null; depth += 1) {
    if (isOwnerFrame(node)) names.push(fiberComponentName(node));
    node = node.return;
  }
  return names;
}
