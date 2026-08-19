import {
  hashComponents,
  type CaptureArtifact,
  type Raster,
} from '@variance-authority/core';
import {
  describeIdentity,
  type BaselineKey,
  type RasterStore,
  type Renderer,
} from '@variance-authority/raster';
import { declaredIgnores } from './decide.js';
import {
  observeAgainstBaseline,
  observeRasters,
  type CompareInputs,
  type Observation,
} from './observe.js';

/** A stored-baseline observation whose candidate may already be a raster. */
export interface ObserveCaptureOptions extends CompareInputs {
  readonly store: RasterStore;
  /** Required only when the artifact carries a document. */
  readonly renderer?: Renderer;
}

/** Observe document or raster capture material through one durable baseline path. */
export async function observeCaptureAgainstBaseline(
  artifact: CaptureArtifact,
  key: BaselineKey,
  options: ObserveCaptureOptions,
): Promise<Observation> {
  const inputs: CompareInputs = {
    ...options,
    ...(options.snapshot === undefined && artifact.snapshot !== undefined
      ? { snapshot: artifact.snapshot }
      : {}),
    ...(options.source === undefined && artifact.source !== undefined
      ? { source: artifact.source }
      : {}),
  };

  if (artifact.material.kind === 'document') {
    if (artifact.material.document.subject.id !== artifact.subject.id) {
      throw new Error('capture artifact subject does not match its render document');
    }
    if (options.renderer === undefined) throw new Error('document capture needs a renderer');
    return await observeAgainstBaseline(artifact.material.document, key, {
      ...inputs,
      renderer: options.renderer,
      store: options.store,
    });
  }

  const snapshot = inputs.snapshot;
  const { components: _stale, ...pixels } = artifact.material.raster;
  const candidate: Raster =
    snapshot === undefined ? pixels : { ...pixels, components: hashComponents(snapshot) };
  const found = await options.store.find(key, candidate.identity);
  // The render cache owns pixels. Component hashes describe the semantic
  // snapshot of this observation and must not leak into a later cache hit.
  await options.store.renderCache.put(pixels);
  const declared = declaredIgnores(snapshot, candidate.identity.deviceScaleFactor);
  const declaredField = declared === undefined ? {} : { ignored: declared };

  if (found === null) {
    return {
      subject: artifact.subject.id,
      verdict: 'new',
      because: `no baseline for \`${key.subject}\` under this renderer; nothing to compare against`,
      regions: [],
      rendered: false,
      missingFonts: candidate.missingFonts,
      ...declaredField,
    };
  }

  if (!found.comparable) {
    return {
      subject: artifact.subject.id,
      verdict: 'incomparable',
      because:
        `a baseline for \`${key.subject}\` exists but was rendered by ` +
        `${describeIdentity(found.storedUnder)}, and this run is ` +
        `${describeIdentity(candidate.identity)}; pixels are machine-bound, so the two are not comparable`,
      regions: [],
      rendered: false,
      missingFonts: candidate.missingFonts,
      ...declaredField,
    };
  }

  return await observeRasters(artifact.subject.id, found.raster, candidate, inputs);
}
