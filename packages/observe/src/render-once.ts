import { hashComponents } from '@variance-authority/core/attribute';
import { documentDigest } from '@variance-authority/core/format';
import type {
  AccessibilitySnapshot,
  ComponentHash,
  Raster,
  RenderDocument,
  SemanticSnapshot,
} from '@variance-authority/core/format';
import type { RasterStore, Renderer } from '@variance-authority/raster';

/**
 * This render's component hashes, when a snapshot of it was supplied.
 *
 * Computed here rather than by the collector so that the hashes and the pixels
 * come from one mount by construction: a collector that hashed separately could
 * hash a document the renderer never saw, and the ordering would then be about a
 * page that was not painted.
 */
export function componentsOf(
  snapshot: SemanticSnapshot | undefined,
): readonly ComponentHash[] | undefined {
  return snapshot === undefined ? undefined : hashComponents(snapshot);
}

/**
 * Render this document, unless an identical one has already been rendered.
 *
 * The deferral lever (Principle 4): content addressing makes "identical" a fact
 * about the document rather than a guess about the branch, so a rebase, a file
 * move, or a rerun costs nothing and a run over 300 subjects where two changed
 * pays for two images.
 *
 * Both halves key on `identityFor`, and the emphasis is earned: the raster
 * package once shipped a `renderCached` that read under `renderer.identity` and
 * wrote under the raster's own. Those differ by exactly the scale factor, so
 * above 1x the cache could never hit its own write and the lever was off
 * precisely where images are most expensive. That function is gone rather than
 * fixed — this is the loop a run actually takes, and one of the two was always
 * going to rot.
 */
export async function renderOnce(
  renderer: Renderer,
  store: RasterStore,
  document: RenderDocument,
  /** This document's component hashes, folded into the raster it produces. */
  components?: readonly ComponentHash[],
  accessibility?: AccessibilitySnapshot,
): Promise<{ raster: Raster; rendered: boolean }> {
  const identity = renderer.identityFor(document);
  const hit = await store.renderCache.get(documentDigest(document), identity);

  // A cache hit is an image of exactly this document, so the hashes computed
  // *here* describe it as well as the ones written with it did. What the cache
  // kept is discarded either way — see `withComponents`.
  if (hit !== null) {
    return { raster: withEvidence(hit, components, accessibility), rendered: false };
  }

  const painted = await renderer.render(document);
  // Pixels only. A render cache is addressed by document digest and holds
  // *images*; component hashes describe a snapshot, which carries provenance a
  // document does not, so two different snapshots share one cache key. Storing
  // them here is what let a warm machine answer with a previous run's hashes —
  // and, because `images.ts` builds the candidate sidecar out of this cache, what
  // would have let `accept` promote a baseline whose hashes belong to a document
  // it is not an image of.
  await store.renderCache.put(painted);
  return { raster: withEvidence(painted, components, accessibility), rendered: true };
}

/**
 * Stamp this run's component hashes onto a raster, and remove anybody else's.
 *
 * The removal is the important half, and it was missing. A render cache is keyed
 * by document digest, and component hashes are not derived from the document —
 * they are derived from the *snapshot*, which carries provenance the document
 * does not. So a cache entry can legitimately hold hashes computed from a
 * different snapshot of the same bytes: rename a component, change nothing it
 * renders, and the digest holds while the hashes move.
 *
 * Left in place, that makes the answer a function of cache warmth. A run with no
 * snapshot returns whatever the cache kept and reports causes; the same run on a
 * cold machine returns none and reports none. ADR-0027 chose *carry* over *fetch*
 * precisely so that ranking could not depend on that, and this is the same
 * failure arriving one layer down.
 *
 * So the rule is unconditional: the hashes on a raster are the ones this run
 * computed, or there are none.
 */
function withEvidence(
  raster: Raster,
  components: readonly ComponentHash[] | undefined,
  accessibility: AccessibilitySnapshot | undefined,
): Raster {
  const { components: staleComponents, accessibility: staleAccessibility, ...pixels } = raster;
  void staleComponents;
  void staleAccessibility;
  return {
    ...pixels,
    ...(components === undefined ? {} : { components }),
    ...(accessibility === undefined ? {} : { accessibility }),
  };
}
