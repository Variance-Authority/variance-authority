import type { AttributedRegion, Isolation } from '@variance-authority/core/attribute';
import {
  DEFAULT_POLICY,
  STRICT_POLICY,
  type DiffPolicy,
  type RasterComparison,
} from '@variance-authority/raster';
import type { CompareInputs } from './observe.js';

/**
 * The clauses a verdict's reason is built from.
 *
 * `decide` chooses the verdict and which clauses follow it; these say what each
 * clause says. Each one is read off the comparison it describes, so a sentence
 * cannot name a policy, a count or a record the verdict was not decided on.
 */

/** What the before side of a comparison is. */
export type BeforeSide = 'baseline' | 'image';

/**
 * The clause a changed sentence carries when its regions were joined against
 * one side's boxes alone.
 *
 * A changed region is the union of what left and what arrived, and a record
 * without its snapshot cannot say where anything was. The regions are still
 * attributed, against this render's boxes, and a control replaced by a larger
 * element is then named by the row it sits in. Absent is not empty: the
 * sentence says the before side's nodes are unknown rather than joining as
 * though nothing had been there.
 *
 * The remedy names a revision where the subject is unchanged because an
 * accepting run re-stamps an unchanged baseline that kept none (`restamps` in
 * `@variance-authority/core/judge`), and a run renders one that settled on its
 * digest so there is an observation to re-stamp (`settle`). Accepting this
 * change records one too, and accepts the change with it.
 */
export function unjoined(beforeIs: BeforeSide): string {
  return beforeIs === 'baseline'
    ? '; the baseline records no snapshot of its nodes, so regions were joined against ' +
        "this render's boxes alone: an accepting run records one on a revision where this " +
        'subject is unchanged'
    : '; the before image records no snapshot of its nodes, so regions were joined ' +
        "against the after image's boxes alone";
}

/**
 * `1 pixel`, `8,818 pixels` — a quantity, rather than a template with the plural
 * left for the reader to apply.
 *
 * These sentences are the `because` a person reads on a review page beside the
 * render they are about, and `8818 pixel(s) differ across 2 region(s)` reads as
 * output rather than as a finding. Grouped, because six digits of pixels is not a
 * number anybody parses as a magnitude on sight.
 */
export function count(value: number, noun: string): string {
  return `${value.toLocaleString('en-US')} ${noun}${value === 1 ? '' : 's'}`;
}

/**
 * The clause a green sentence owes for the pixels its policy did not count.
 *
 * Every green sentence carries it, the relaxed one included: `pixels differ`
 * there says nothing about how many, and the forgiven ones are still pixels the
 * strict policy saw.
 *
 * Empty when the strict policy found nothing more: then "no pixels differ" is
 * true of the images themselves. Otherwise it names the policy and what that
 * policy forgives, read off the policy rather than written out, so a threshold
 * that moves cannot leave the sentence describing the old one. Both reasons are
 * named whenever both apply, because one count cannot tell them apart.
 *
 * Counted over the whole comparison. `comparison.mask` is the isolation
 * policy's mask before any box is subtracted, and the strict policy counts
 * every pixel it does and more, so the difference is exact, and it includes
 * pixels forgiven inside an excluded box (ADR-0026).
 */
export function forgiveness(comparison: RasterComparison, options: CompareInputs): string {
  const policy: DiffPolicy = options.compare?.isolateWith ?? DEFAULT_POLICY;
  const strict = comparison.changed[STRICT_POLICY.id];
  if (strict === undefined || policy.id === STRICT_POLICY.id) return '';
  const forgiven = strict - comparison.mask.changed;
  if (forgiven <= 0) return '';

  const reasons = [
    ...(!policy.includeAA && STRICT_POLICY.includeAA ? ['as antialiasing'] : []),
    ...(policy.threshold > STRICT_POLICY.threshold
      ? [`as a colour change of at most ${Number((policy.threshold * 100).toFixed(2))}%`]
      : []),
  ];
  return (
    ` beyond the tolerance of the ${policy.id} policy, which forgave ${count(forgiven, 'pixel')}` +
    (reasons.length === 0 ? '' : ` ${reasons.join(' or ')}`)
  );
}

export function describeChange(
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
      ? ` (+${count(isolation.truncated, 'smaller region')} not listed, ` +
        `${isolation.truncatedPixels.toLocaleString('en-US')}px)`
      : '';

  return (
    `${count(changed, 'pixel')} differ across ` +
    `${count(isolation.regions.length, 'region')}${where}${size}${capped}`
  );
}
