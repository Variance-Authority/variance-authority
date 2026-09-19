/**
 * Two things the observation path needs and does not decide.
 *
 * Which engine painted a subject is part of a baseline's identity, and
 * promoting one is the acceptance path's last step. Both are here because the
 * fixture module is about wiring a runner's fixtures together, and neither of
 * these knows a runner exists.
 */

import type { Page } from '@playwright/test';
import { hashComponents } from '@variance-authority/core/attribute';
import { documentDigest } from '@variance-authority/core/format';
import type { AccessibilitySnapshot, SemanticSnapshot } from '@variance-authority/core/format';
import type { BaselineKey, RasterStore, Renderer } from '@variance-authority/raster';


export function engineOf(page: Page): string {
  const browser = page.context().browser();
  const name = browser?.browserType().name() ?? 'browser';
  return `${name}@${browser?.version() ?? 'unknown'}`;
}

/**
 * Promote the candidate this run already painted.
 *
 * The image is taken from the render cache rather than rendered again, which is
 * not only a saving: re-rendering here would produce a *second* image and store
 * that one, so the bytes a reviewer approved and the bytes that became the
 * baseline would be two different renders that nobody compared. A cache miss is
 * therefore refused rather than papered over — the cache never throws and is
 * allowed to be cold, and "cold" is exactly the case where there is no candidate
 * to promote.
 */
export async function promote(
  store: RasterStore,
  renderer: Renderer,
  document: Parameters<typeof documentDigest>[0],
  key: BaselineKey,
  /** This run's snapshot of the same render. See below. */
  snapshot: SemanticSnapshot,
  accessibility: AccessibilitySnapshot,
): Promise<void> {
  const identity = renderer.identityFor(document);
  const candidate = await store.renderCache.get(documentDigest(document), identity);

  if (candidate === null) {
    throw new Error(
      `cannot accept \`${key.subject}\`: this run produced no candidate for it. ` +
        'Acceptance promotes an image the run already painted and never paints one',
    );
  }

  // The image comes from the cache and the hashes do not. A render cache is keyed
  // by document digest and holds images; component hashes describe a snapshot,
  // which carries provenance a document does not (ADR-0027). Promoting the cached
  // raster as-is would record a baseline with no hashes at all, so every later run
  // against it would rank regions by area — the ordering journal 0013 measured as
  // backwards — on the one surface where both documents were in hand.
  await store.put(key, {
    ...candidate,
    components: hashComponents(snapshot),
    accessibility,
  });
}
