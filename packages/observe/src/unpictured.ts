import { mergeDiagnostics, pictured, type Raster } from '@variance-authority/core/format';
import { attributionOf } from './attribution.js';
import { accessibilityBetween, decide } from './decide.js';
import type { CompareInputs, Observation } from './observe.js';

/**
 * The tier for a subject that was never photographed.
 *
 * Split from `decide.ts` because it is the half that answers *without pixels*,
 * and the two are read for opposite reasons: that file is written against a pair
 * it knows it has — no non-null assertions, no image path reachable without an
 * image — and this one is written against a pair where at least one side has no
 * image at all, which is a measurement rather than a loss.
 *
 * Measured on Material UI's unit tier: 1109 of 4371 subjects. Its
 * `describeConformance` harness mounts each component with no children, so
 * `<AlertTitle />` is an empty div with margins and occupies nothing. Refusing to
 * photograph that is right; refusing the whole subject reported a quarter of the
 * tier as unobserved while the capture held its markup, its rules, its component
 * hashes and its accessibility tree, and nothing about any of them was in doubt.
 */

/**
 * Two rasters, photographed or not, become a verdict.
 *
 * The entry point every composition in `observe.ts` calls, and the one place
 * that asks whether there are pixels to compare at all.
 */
export async function decideRasters(
  subject: string,
  before: Raster,
  after: Raster,
  rendered: boolean,
  options: CompareInputs,
): Promise<Observation> {
  if (pictured(before) && pictured(after)) {
    return await decide(subject, before, after, rendered, options);
  }
  return withoutPixels(subject, before, after, rendered, options);
}

/**
 * The comparison a subject with no pixels can still take.
 *
 * It answers from the document digest, the component hashes and the
 * accessibility tree — the three things a capture holds whether or not anything
 * was painted.
 *
 * **Document movement is the verdict here, and only here.** {@link decide} names
 * it as a signal and refuses to let it decide, because two reconstruction inputs
 * can differ while both independently observed images agree, and the images are
 * the better evidence. Take the images away and the argument goes with them: the
 * document is not a weaker witness to the same fact any more, it is the only
 * witness there is. Reporting `unchanged` on a subject whose markup and rules
 * both moved would be reporting that nothing happened because nobody looked.
 */
function withoutPixels(
  subject: string,
  before: Raster,
  after: Raster,
  rendered: boolean,
  options: CompareInputs,
): Observation {
  const missingFonts = [...new Set([...before.missingFonts, ...after.missingFonts])];
  const attribution = attributionOf(before.components, after.components);
  const accessibility = accessibilityBetween(before, after);
  const diagnostics = mergeDiagnostics(options.snapshot?.diagnostics);
  const diagnosticsField = diagnostics.length === 0 ? {} : { diagnostics };
  const documentMoved = before.documentDigest !== after.documentDigest;
  const document = documentMoved ? ('changed' as const) : ('unchanged' as const);
  const accessibilityField = accessibility === undefined ? {} : { accessibility };

  // A subject that gained or lost its pixels. Deliberately not `incomparable`:
  // nothing about the two records is mismatched — same painter, same subject,
  // same kind of evidence — and the transition is itself the most reviewable
  // thing that can happen to such a subject. An empty wrapper that started
  // painting is a portal that stopped working, or a child that arrived; a
  // painted subject that went empty is the reverse. Calling that "cannot say"
  // would file the one finding under the one verdict nobody reviews.
  if (pictured(before) !== pictured(after)) {
    const gained = pictured(after);
    const size = gained ? sizeOf(after) : sizeOf(before);

    return {
      subject,
      verdict: 'changed',
      because: gained
        ? `\`${subject}\` occupied no pixels when the baseline was recorded and now occupies ${size} device pixels`
        : `\`${subject}\` occupied ${size} device pixels when the baseline was recorded and now occupies none`,
      regions: [],
      rendered,
      missingFonts,
      signals: { document, pixels: 'changed' as const, ...accessibilityField },
      ...attribution,
      ...diagnosticsField,
    };
  }

  // Neither side was photographed. `unobservable` rather than `unchanged`: there
  // was nothing to measure, and a reader who saw `unchanged` on the pixel axis
  // would take it as evidence the images agreed.
  const signals = { document, pixels: 'unobservable' as const, ...accessibilityField };
  const accessibilityMoved = accessibility?.verdict === 'changed';

  if (!documentMoved && !accessibilityMoved) {
    return {
      subject,
      verdict: 'unchanged',
      because:
        `\`${subject}\` occupies no pixels on either side, and its document, rules and ` +
        'accessibility tree are identical',
      regions: [],
      rendered,
      missingFonts,
      signals,
      ...attribution,
      ...diagnosticsField,
    };
  }

  return {
    subject,
    verdict: 'changed',
    because:
      `\`${subject}\` occupies no pixels, and ` +
      (documentMoved && accessibilityMoved
        ? 'both its document and its accessibility tree changed'
        : documentMoved
          ? 'its document or rules changed'
          : 'its accessibility tree changed'),
    regions: [],
    rendered,
    missingFonts,
    signals,
    ...attribution,
    ...diagnosticsField,
  };
}

/** The side that has an image, in the device pixels every other count is in. */
function sizeOf(raster: Raster): string {
  return `${raster.width ?? 0}×${raster.height ?? 0}`;
}
