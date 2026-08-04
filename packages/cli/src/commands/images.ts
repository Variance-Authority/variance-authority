import { dirname, join, relative } from 'node:path';
import {
  documentDigest,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
} from '@variance-authority/core';
import type { Observation } from '@variance-authority/observe';
import { decode, diffImage } from '@variance-authority/png';
import type { BaselineKey, RasterStore, Renderer } from '@variance-authority/raster';
import type { ObservationRecord } from '@variance-authority/report';
import type { Config } from '../config.js';
import type { RunDeps } from './run-context.js';

/**
 * The bytes a run leaves behind, and the reason a run that leaves none is a run
 * nothing can be accepted from.
 *
 * Its own file because these two functions are the only place in the command that
 * touches image *bytes* at all. Everything else works on digests, sidecars and
 * verdicts — deliberately, since a 300-subject report holding two PNGs per
 * subject in memory is the shape that makes this tool unusable on a real suite —
 * so the one place that does read pixels is worth being able to find.
 */

/**
 * Write the candidate image, its sidecar, and a diff — and say where they went.
 *
 * The image is what makes a subject *acceptable*. `accept` is forbidden to
 * re-run, so if the run does not leave the bytes behind, the only way to promote
 * a reviewed change is to render it again on a machine that may no longer be the
 * same one — which is the failure the identity partition exists to prevent.
 *
 * The sidecar carries the `Raster` minus its bytes, in the same `<name>.png` /
 * `<name>.json` pairing the durable store itself uses. Without it `accept` would
 * have to invent a width, a scale, and a document digest for the baseline it
 * writes, and an invented digest defeats `settle` on every later run.
 */
export async function images(
  id: string,
  observation: Observation,
  document: RenderDocument,
  renderer: Renderer,
  config: Config,
  deps: RunDeps,
  /**
   * The baseline to subtract from, or `null` where there is no stored one.
   *
   * `null` is the ephemeral path, and it is a key rather than a raster because
   * the lookup now happens here. Passing a key to a store that answers `null` to
   * everything would work and would say the wrong thing: this mode has no
   * baseline, and the code should not have to reach a no-op backend to find that
   * out.
   */
  key: BaselineKey | null,
): Promise<{ images?: ObservationRecord['images'] }> {
  const raster = await candidateRaster(deps.store, document, renderer);
  if (raster === null) return {};

  const base = join(config.images, encodeURIComponent(id));
  const reportDir = dirname(config.report);

  await deps.writeArtifact(`${base}.after.png`, decode(raster.bytes));
  await deps.writeArtifact(
    `${base}.after.json`,
    Buffer.from(`${JSON.stringify({ ...raster, bytes: undefined }, null, 2)}\n`, 'utf8'),
  );

  if (key === null || observation.verdict !== 'changed') {
    return { images: { after: relative(reportDir, `${base}.after.png`) } };
  }

  // The baseline's *bytes*, looked up here rather than handed in, and this is
  // the only place in a run that wants them. Once the settlement query stopped
  // reading images there was no full lookup left to reuse, and reinstating one
  // for every subject in order to serve the few that write a diff would have
  // given back exactly what `describe` was adopted to save.
  //
  // After the verdict check on purpose: `unchanged`, `new` and `incomparable`
  // never write a `before.png`, so for them this read would be pure waste.
  const before = (await deps.store.find(key, renderer.identity))?.raster;
  if (before === undefined) {
    // No `before` means nothing to subtract from, so a diff image would be the
    // candidate itself painted red. Omitted rather than written, and its absence
    // is visible in the record, which lists exactly the images that exist.
    return { images: { after: relative(reportDir, `${base}.after.png`) } };
  }

  await deps.writeArtifact(`${base}.before.png`, decode(before.bytes));
  await deps.writeArtifact(
    `${base}.diff.png`,
    diffImage(decode(before.bytes), decode(raster.bytes)),
  );

  return {
    images: {
      before: relative(reportDir, `${base}.before.png`),
      after: relative(reportDir, `${base}.after.png`),
      diff: relative(reportDir, `${base}.diff.png`),
    },
  };
}

/**
 * Recover the image the pipeline just produced, from the store's own render cache.
 *
 * Read back rather than threaded out of `Observation`, which deliberately carries
 * no bytes — a 300-subject report holding two PNGs per subject in memory is the
 * shape that makes this tool unusable on a real suite. The cache has them under
 * the document's digest, so this is a lookup, not a render.
 *
 * **Two keys, and the reason is a seam in the tier below.** A renderer reports
 * `deviceScaleFactor: 1` until it knows the document, whose viewport supplies the
 * real one — so a raster is written under a scaled identity while a caller
 * holding only the renderer has the unscaled one. At 1x they coincide and the
 * first key hits. Above 1x only the second does. Trying both is two cheap
 * lookups; guessing one would silently lose every image on a 2x run, and a
 * missing image is a subject that cannot be accepted.
 *
 * `null` is a real answer — some renderer or store combination kept nothing — and
 * it produces a record with no `images`, which `accept` later refuses by name
 * rather than by re-rendering.
 */
async function candidateRaster(
  store: RasterStore,
  document: RenderDocument,
  renderer: Renderer,
): Promise<Raster | null> {
  const digest = documentDigest(document);
  const scaled: RenderIdentity = {
    ...renderer.identity,
    deviceScaleFactor: document.viewport.deviceScaleFactor,
  };

  return (
    (await store.renderCache.get(digest, scaled)) ??
    (await store.renderCache.get(digest, renderer.identity))
  );
}
