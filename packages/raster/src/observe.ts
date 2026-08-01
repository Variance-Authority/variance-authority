import {
  attributeRegions,
  isolateRegions,
  type AttributedRegion,
  type Isolation,
  type Raster,
  type RenderDocument,
  type SemanticSnapshot,
  type SourceIndex,
} from '@variance-authority/core';
import { formatSource, resolveSource } from '@variance-authority/core';
import { compareRasters, DEFAULT_POLICY, type CompareOptions, type RasterComparison } from './compare.js';
import type { Renderer } from './renderer.js';
import { renderCached, type BaselineKey, type RasterStore } from './store.js';

/**
 * The composition — the phases, wired, and nothing else.
 *
 * Every step below is a function defined elsewhere and testable without this one:
 * acquisition needs a DOM, rendering needs a renderer, comparison needs two PNGs,
 * isolation needs a bitmask, attribution needs a snapshot. Keeping the wiring in
 * its own file is what stops the pipeline from becoming the only place any of it
 * can be exercised — the failure that makes a system with a browser in it
 * untestable in practice.
 *
 * What this file adds is the part that is genuinely about *composition*: which
 * verdicts exist, and which of them are allowed to be `unchanged`.
 */

export type RasterVerdict =
  | 'unchanged'
  | 'changed'
  /** No baseline for this subject. Not a pass, and not a failure. */
  | 'new'
  /**
   * A baseline exists, produced by a different machine.
   *
   * The verdict that keeps the durable mode honest. Comparing across identities
   * yields a large, confident diff caused by a font stack or a driver, which the
   * report would then attribute to whichever component happens to sit under the
   * pixels — so the comparison is refused instead. `unchanged` is never available
   * here: an unobservable difference must never be reported as no difference
   * (ADR-0002, ADR-0008).
   */
  | 'incomparable';

export interface Observation {
  readonly subject: string;
  readonly verdict: RasterVerdict;
  /** One sentence stating what happened and why it has this verdict. */
  readonly because: string;

  readonly comparison?: RasterComparison;
  readonly isolation?: Isolation;
  /** Empty unless a snapshot was supplied — geometry alone cannot name a node. */
  readonly regions: readonly AttributedRegion[];

  /** `false` when the image came from the cache rather than from a renderer. */
  readonly rendered: boolean;
  /** Fonts the document declared and the renderer did not have. */
  readonly missingFonts: readonly string[];
}

export interface ObserveOptions {
  readonly renderer: Renderer;
  readonly store: RasterStore;

  /**
   * The normalized snapshot of the same render.
   *
   * Optional, and the whole reason to bother. Without it an observation is a
   * pixel count with coordinates — the state of the art, and unassignable. With
   * it every region carries the node it landed on, the component that produced
   * that node, and the landmark path someone would use to describe where it is.
   */
  readonly snapshot?: SemanticSnapshot;
  readonly source?: SourceIndex;

  readonly compare?: CompareOptions;
  /** Grid at which neighbouring changed pixels count as one place. */
  readonly cell?: number;
  readonly limit?: number;
}

/**
 * **Ephemeral**: render both sides now, compare, keep nothing.
 *
 * No baseline, no store, no pinned machine — the two images come from one
 * renderer in one run, so the machine-bound inputs are identical by construction
 * rather than by container. This is the cheap mode and it is cheap because it
 * removes a requirement instead of satisfying it.
 */
export async function observePair(
  before: RenderDocument,
  after: RenderDocument,
  options: ObserveOptions,
): Promise<Observation> {
  const left = await renderCached(options.renderer, options.store, before);
  const right = await renderCached(options.renderer, options.store, after);

  return report(after.subject.id, left.raster, right.raster, left.rendered || right.rendered, options);
}

/**
 * **Durable**: render this side, compare against a stored baseline.
 *
 * The baseline is looked up under *any* identity and the comparability check is
 * explicit, so a run on the wrong machine says so in one sentence instead of
 * failing every subject for reasons nobody can attribute.
 */
export async function observeAgainstBaseline(
  document: RenderDocument,
  key: BaselineKey,
  options: ObserveOptions,
): Promise<Observation> {
  const found = await options.store.find(key, options.renderer.identity);
  const fresh = await renderCached(options.renderer, options.store, document);

  if (found === null) {
    return {
      subject: document.subject.id,
      verdict: 'new',
      because: `no baseline for \`${key.subject}\` under this renderer; nothing to compare against`,
      regions: [],
      rendered: fresh.rendered,
      missingFonts: fresh.raster.missingFonts,
    };
  }

  if (!found.comparable) {
    return {
      subject: document.subject.id,
      verdict: 'incomparable',
      because:
        `a baseline for \`${key.subject}\` exists but was rendered by ` +
        `${describe(found.storedUnder)}, and this run is ${describe(options.renderer.identity)}; ` +
        'pixels are machine-bound, so the two are not comparable',
      regions: [],
      rendered: fresh.rendered,
      missingFonts: fresh.raster.missingFonts,
    };
  }

  return report(document.subject.id, found.raster, fresh.raster, fresh.rendered, options);
}

function report(
  subject: string,
  before: Raster,
  after: Raster,
  rendered: boolean,
  options: ObserveOptions,
): Observation {
  const comparison = compareRasters(before, after, options.compare ?? {});
  const policy = options.compare?.isolateWith ?? DEFAULT_POLICY;
  const changed = comparison.changed[policy.id] ?? 0;

  const missingFonts = [...new Set([...before.missingFonts, ...after.missingFonts])];

  if (changed === 0 && !comparison.dimensionsChanged) {
    return {
      subject,
      verdict: 'unchanged',
      because:
        missingFonts.length > 0
          ? `no pixels differ, but the renderer lacked ${missingFonts.join(', ')} on both sides, ` +
            'so both images are of a substituted font'
          : 'no pixels differ',
      comparison,
      regions: [],
      rendered,
      missingFonts,
    };
  }

  const isolation = isolateRegions(comparison.mask, {
    ...(options.cell !== undefined ? { cell: options.cell } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });

  const regions =
    options.snapshot === undefined
      ? []
      : attributeRegions(isolation.regions, options.snapshot, {
          scale: after.identity.deviceScaleFactor,
        });

  return {
    subject,
    verdict: 'changed',
    because: describeChange(comparison, isolation, regions, changed),
    comparison,
    isolation,
    regions,
    rendered,
    missingFonts,
  };
}

function describeChange(
  comparison: RasterComparison,
  isolation: Isolation,
  regions: readonly AttributedRegion[],
  changed: number,
): string {
  const size = comparison.dimensionsChanged
    ? `, and the subject resized from ${comparison.before.width}×${comparison.before.height} ` +
      `to ${comparison.after.width}×${comparison.after.height}`
    : '';

  const named = [...new Set(regions.map((region) => region.component).filter(Boolean))];
  const where =
    named.length > 0
      ? ` in ${named.slice(0, 3).join(', ')}${named.length > 3 ? ` (+${named.length - 3} more)` : ''}`
      : '';

  const capped =
    isolation.truncated > 0
      ? ` (+${isolation.truncated} smaller region(s) not listed, ${isolation.truncatedPixels}px)`
      : '';

  return `${changed} pixel(s) differ across ${isolation.regions.length} region(s)${where}${size}${capped}`;
}

function describe(identity: { renderer: string; engine: string; platform: string; deviceScaleFactor: number }): string {
  return `${identity.renderer} (${identity.engine}, ${identity.platform}, ${identity.deviceScaleFactor}x)`;
}

/**
 * The observation as the thing a reviewer or an agent reads.
 *
 * The same shape the semantic report settled on, for the same reasons: a cause
 * per line rather than a picture, and a file path on the end, because `Toggle` is
 * an identifier and `src/ds/components.tsx:107` is an edit.
 */
export function summarizeObservation(
  observation: Observation,
  options: { readonly source?: SourceIndex } = {},
): string {
  const head = `[${observation.verdict}] ${observation.subject} — ${observation.because}`;
  if (observation.regions.length === 0) return head;

  const lines = observation.regions.map((region) => {
    const what = region.unattributed
      ? `unattributed${region.nearest?.component !== undefined ? ` (nearest: ${region.nearest.component})` : ''}`
      : (region.component ?? region.path ?? '?');

    const file =
      options.source !== undefined && region.component !== undefined
        ? resolveSource(region.component, options.source)
        : null;

    return [
      `  ${region.region.pixels}px at ${region.region.x},${region.region.y} — ${what}`,
      region.where !== undefined ? `      in ${region.where}` : null,
      file !== null ? `      ${formatSource(file)}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  });

  return [head, ...lines].join('\n');
}
