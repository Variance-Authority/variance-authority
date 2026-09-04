import { propsDigest, type Digest } from '@variance-authority/core';

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
): Digest {
  return propsDigest(digestableProps(props));
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
