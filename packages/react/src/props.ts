import { propsDigest, type Digest } from '@variance-authority/core/format';

/**
 * The props digest at one composite boundary, computed once for both readers.
 *
 * Two records carry this value and they are compared against *each other*.
 * `OwnerFrame.propsDigest` (`resolve.ts`) describes the boundaries enclosing a
 * node that was read; `CommitUpdaterFrame.propsDigest` (`updaters.ts`) describes
 * where the fiber that initiated a commit sat. Deciding whether an update
 * initiator sat inside or outside the component paths a test addressed is a walk
 * over the common suffix of those two paths demanding name *and* digest equality
 * at every frame, so the answer holds only while both sides project props the
 * same way.
 *
 * That is why the projection lives alone rather than beside either caller. A
 * second copy is not a tidiness question: exclude one more key on one side, or
 * order the traversal differently, and both types stay satisfied, nothing
 * throws, and every join misses. The degraded output is not silence — it is the
 * sentence "outside addressed component paths", which reads as a finding and
 * gets acted on.
 *
 * Shaping and digesting are one call for the same reason. Handing out the shaper
 * alone would leave a caller free to digest a differently shaped object, which
 * is the same divergence with an extra step in front of it.
 */
export function boundaryPropsDigest(
  props: Readonly<Record<string, unknown>> | null,
  pass?: DigestPass,
): Digest {
  if (props === null || pass === undefined) return propsDigest(digestableProps(props));

  const remembered = pass.get(props);
  if (remembered !== undefined) return remembered;

  const digest = propsDigest(digestableProps(props));
  pass.set(props, digest);
  return digest;
}

/**
 * What one collection already digested, so it does not digest it again.
 *
 * The waste this removes is not incidental. `provenanceOf` runs per DOM node and
 * walks that node's owner chain, so a component twenty boundaries deep has every
 * one of those twenty props objects digested again for each of its descendants.
 * Measured on MUI's `docs-product-x/XHero`: 27,950 calls over 1,470 distinct
 * props objects, a 19x repetition; on its dashboard template, 33x. Each of those
 * calls walks a prop graph that, on a page handing components a theme or a grid
 * API handle, is large enough that the repetition alone accounted for minutes.
 *
 * Keyed on the props object's identity, so a hit returns the digest the same
 * input would have produced — the projection is a pure function of the object,
 * and nothing about the value recorded depends on the cache existing.
 *
 * **Scoped to one collection, and it has to be.** React allocates a fresh props
 * object per render, so identity is a sound key *within* a moment. It is not one
 * across moments: a prop holding a mutable handle — a `useRef` cell, a grid's
 * private API — keeps its identity while its contents move, and a memo that
 * outlived the collection would answer a later question about a changed graph
 * with an earlier answer. A pass begins where a page agent begins a capture and
 * ends with it, which is the interval the page is held still for anyway.
 */
export type DigestPass = WeakMap<Readonly<Record<string, unknown>>, Digest>;

/** A memo for one collection. See {@link DigestPass}. */
export function digestPass(): DigestPass {
  return new WeakMap();
}

/**
 * Props as they enter this boundary, minus `children`.
 *
 * Excluding `children` is not a convenience — it is what makes §6.2's
 * root/collateral distinction work at all. `children` *is* the subtree, and the
 * snapshot already captures the subtree structurally. Digesting it here would
 * mean any change anywhere below a component alters that component's incoming
 * props digest, and every ancestor's too. §6.2 declares a component the **root**
 * of a change when its subtree changed *while its incoming props held*; if a
 * descendant edit moved every ancestor's digest, that condition could never
 * hold, every change would read as "arrived from outside", and the root would
 * always be reported as the application shell.
 *
 * The cost is real and bounded: swapping which element is passed as `children`
 * while everything else holds does not move this digest. That change is still
 * caught — the subtree diff sees it — it is just attributed to the enclosing
 * component rather than to the prop provider.
 */
function digestableProps(props: Readonly<Record<string, unknown>> | null): Record<string, unknown> {
  if (props === null || typeof props !== 'object') return {};

  const shaped: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === 'children') continue;
    shaped[key] = props[key];
  }
  return shaped;
}
