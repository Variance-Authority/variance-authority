import { bandsBetween } from '@variance-authority/core/attribute';
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
  const accessibilityField = accessibility === undefined ? {} : { accessibility };

  // A subject that gained or lost its pixels. Deliberately not `incomparable`:
  // nothing about the two records is mismatched — same painter, same subject,
  // same kind of evidence — and the transition is itself the most reviewable
  // thing that can happen to such a subject. An empty wrapper that started
  // painting is a portal that stopped working, or a child that arrived; a
  // painted subject that went empty is the reverse. Calling that "cannot say"
  // would file the one finding under the one verdict nobody reviews.
  if (pictured(before) !== pictured(after)) {
    const document =
      before.documentDigest === after.documentDigest ? ('unchanged' as const) : ('changed' as const);
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
  const document = documentMovedUnpainted(before, after);
  const signals = { document, pixels: 'unobservable' as const, ...accessibilityField };
  const accessibilityMoved = accessibility?.verdict === 'changed';

  if (document === 'unchanged' && !accessibilityMoved) {
    return {
      subject,
      verdict: 'unchanged',
      because:
        before.documentDigest === after.documentDigest
          ? `\`${subject}\` occupies no pixels on either side, and its document, rules and ` +
            'accessibility tree are identical'
          : `\`${subject}\` occupies no pixels on either side; its markup differs only in what ` +
            'the component hashes leave out, and its accessibility tree is identical',
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
      (document === 'changed' && accessibilityMoved
        ? 'both its document and its accessibility tree changed'
        : document === 'changed'
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

/**
 * Whether the document of a subject that paints nothing on either side moved.
 *
 * The raw digest is the render cache's key, so it covers every byte of markup:
 * a random `className`, a `Math.random` id, a `data-testid` a harness made up.
 * Material UI's conformance tests put all three on every mount, so its markup
 * differs between two runs of one commit while every band the normalized layer
 * keeps (ADR-0003) is byte-identical. Read raw, 209 of its 1235 subjects with no
 * pixels were reported changed, each with no component that moved.
 *
 * So a moved digest is read through the component hashes when both sides carry
 * them, by the same {@link bandsBetween} a sensitivity level reads: the document
 * moved only if some component, `(unattributed)` included, moved a band or is
 * on one side only. A component rendered once more moves its `structure`. The
 * hashes can only clear a moved digest, never move a still one, and a side
 * without them, or with an empty list, leaves the raw answer standing. Not
 * `attribution.moved`: `movedBandsBetween` skips `(unattributed)`, and a change
 * outside every component is still a change.
 *
 * Only here, where the document is the verdict and nothing it leaves out can
 * reach a pixel. A painted subject is decided by its pixels, and an
 * incomparable one carries the raw answer, which is what lets `accept --all`
 * adopt a recipe bump only where the markup did not move at all.
 */
function documentMovedUnpainted(before: Raster, after: Raster): 'unchanged' | 'changed' {
  if (before.documentDigest === after.documentDigest) return 'unchanged';
  if (!before.components?.length || !after.components?.length) return 'changed';
  return bandsBetween(before.components, after.components).length === 0 ? 'unchanged' : 'changed';
}

/** The side that has an image, in the device pixels every other count is in. */
function sizeOf(raster: Raster): string {
  return `${raster.width ?? 0}×${raster.height ?? 0}`;
}
