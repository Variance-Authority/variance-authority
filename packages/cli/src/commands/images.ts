import { dirname, join, relative } from 'node:path';
import { hashComponents } from '@variance-authority/core/attribute';
import {
  documentDigest,
  fileNameFor,
  pictured,
  type Raster,
  type RenderDocument,
  type SemanticSnapshot,
} from '@variance-authority/core/format';
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
  /** This run's snapshot of the same render, when the collector supplied one. */
  snapshot?: SemanticSnapshot,
  /**
   * What inspection found in this render, as marks.
   *
   * Handed in rather than derived from `snapshot` here, so that the list a
   * baseline is later judged against is the same list this run printed. A second
   * `inspect` call in this file would be a second definition of what a finding
   * is, and the two would agree until one of them was changed.
   */
  findingMarks?: readonly string[],
): Promise<{ images?: ObservationRecord['images'] }> {
  const cached = await candidateRaster(deps.store, document, renderer);
  if (cached === null) return {};

  // The hashes are attached here rather than read back out of the cache. They
  // describe the snapshot this run collected, and the cache is keyed by the
  // document — so a cache hit is the right *image* and says nothing about whose
  // components it was written beside (ADR-0027, and `withComponents`).
  const raster: Raster = {
    ...cached,
    ...(snapshot === undefined ? {} : { components: hashComponents(snapshot) }),
    // Written on the candidate, which is the file `accept` promotes. That is the
    // whole path by which a defect found today becomes a defect the next run can
    // call standing: nothing inspects a baseline, because a baseline is a PNG.
    ...(findingMarks === undefined ? {} : { findingMarks }),
    // FIXME: no `accessibility`, and it is a missing acquisition rather than a
    // dropped field. `Raster` carries a browser accessibility snapshot, every
    // store keeps one, `settle` compares them and `decide` gives the axis its
    // own verdict — but the only thing in this repository that *acquires* one is
    // the Playwright fixture, and the collector contract this command runs
    // against (`@variance-authority/route-collector`, `Collected`) has no field
    // for it. The render cache cannot supply it either: `renderCache.put` is
    // given the renderer's own output, and `withEvidence` strips whatever a hit
    // carried, on the same rule that governs component hashes — the evidence on
    // a raster is what *this* run observed, or there is none.
    //
    // What it costs: a baseline promoted from this sidecar records no
    // accessibility evidence, so a later run that does have a snapshot calls the
    // axis `incomparable` rather than `unchanged`. That is the safe direction —
    // the alternative is a stale tree asserted as current — which is why this is
    // a gap and not a defect. Closing it means the collector acquiring the
    // snapshot; every layer downstream of here already carries it.
  };

  const base = join(config.images, fileNameFor(id));
  const reportDir = dirname(config.report);

  // The sidecar is written for every subject, photographed or not. It is the
  // document, the rules, the component hashes and the accessibility tree, and for
  // a subject that occupies no pixels it is the entire record — the half of the
  // evidence that never needed a camera.
  if (pictured(raster)) await deps.writeArtifact(`${base}.after.png`, decode(raster.bytes));
  await deps.writeArtifact(
    `${base}.after.json`,
    Buffer.from(`${JSON.stringify({ ...raster, bytes: undefined }, null, 2)}\n`, 'utf8'),
  );

  const record = relative(reportDir, `${base}.after.json`);

  // No picture, so the sidecar is the candidate. `accept` promotes it as one:
  // refusing here on the ground that there is no PNG would leave a subject the
  // run *did* observe — it reached a document verdict without a camera — with no
  // way ever to become a baseline, and a tier where nothing can be accepted is
  // not a tier.
  if (!pictured(raster)) return { images: { record } };

  // `changed` and `ignored` are the two verdicts a person looks at, so they are
  // the two that get a pair.
  //
  // `ignored` was excluded here, and that was the wrong half to save. The verdict
  // means pixels *did* differ and every one of them fell inside a mask somebody
  // wrote — which makes it the only verdict where the question is about the mask
  // rather than about the render. "Has this ignore grown over a regression?" is
  // answerable from a `before` and a diff and from nothing else: the candidate
  // alone shows the masked region looking exactly as intended, because that is
  // what a mask does. Shipping only the `after` left the review surface with the
  // one image that cannot answer it.
  //
  // What it costs: an ignored subject now pays a baseline read, a diff render and
  // two more uploads, the same as a changed one. That is the price of the
  // evidence, and a suite where it is a large price is a suite ignoring a lot.
  if (key === null || (observation.verdict !== 'changed' && observation.verdict !== 'ignored')) {
    return { images: { record, after: relative(reportDir, `${base}.after.png`) } };
  }

  // The baseline's *bytes*, looked up here rather than handed in, and this is
  // the only place in a run that wants them. Once the settlement query stopped
  // reading images there was no full lookup left to reuse, and reinstating one
  // for every subject in order to serve the few that write a diff would have
  // given back exactly what `describe` was adopted to save.
  //
  // After the verdict check on purpose: `unchanged`, `new` and `incomparable`
  // never write a `before.png`, so for them this read would be pure waste.
  const stored = (await deps.store.find(key, renderer.identityFor(document)))?.raster;
  // A baseline that occupies no pixels is not a `before` anybody can look at, and
  // subtracting it is not defined. The candidate alone is the evidence, and the
  // observation's sentence already says the subject gained its pixels.
  const before = stored === undefined || !pictured(stored) ? undefined : stored;
  if (before === undefined) {
    // No `before` means nothing to subtract from, so a diff image would be the
    // candidate itself painted red. Omitted rather than written, and its absence
    // is visible in the record, which lists exactly the images that exist.
    return { images: { record, after: relative(reportDir, `${base}.after.png`) } };
  }

  await deps.writeArtifact(`${base}.before.png`, decode(before.bytes));
  await deps.writeArtifact(
    `${base}.diff.png`,
    diffImage(decode(before.bytes), decode(raster.bytes)),
  );

  return {
    images: {
      record,
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
 * The renderer owns its document-specific identity. Asking it here keeps image
 * recovery on the same key as rendering and baseline lookup, including scale.
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
  return await store.renderCache.get(digest, renderer.identityFor(document));
}
