import type { CaptureArtifact } from '@variance-authority/core';
import { hashComponents } from '@variance-authority/core/attribute';
import type { Raster } from '@variance-authority/core/format';
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
    ...(options.accessibility === undefined && artifact.accessibility !== undefined
      ? { accessibility: artifact.accessibility }
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

  if (artifact.material.kind === 'value') {
    // FIXME: a value capture is compared against a value baseline, and this
    // store holds rasters — spec 0031 needs the store surface before the
    // comparison can run here. Refused by name rather than narrowed away,
    // because a caller that reads a missing verdict as `unchanged` would report
    // a green run for a subject nothing looked at.
    throw new Error(
      `\`${artifact.subject.id}\` is a value capture, and this observation compares rasters`,
    );
  }

  const snapshot = inputs.snapshot;
  const { components: _staleComponents, accessibility: _staleAccessibility, ...pixels } =
    artifact.material.raster;
  void _staleComponents;
  void _staleAccessibility;
  const candidate: Raster =
    {
      ...pixels,
      ...(snapshot === undefined ? {} : { components: hashComponents(snapshot) }),
      ...(inputs.accessibility === undefined ? {} : { accessibility: inputs.accessibility }),
    };
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
