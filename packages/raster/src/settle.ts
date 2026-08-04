import type { Digest, RenderIdentity } from '@variance-authority/core';
import { describeIdentity } from './renderer.js';
import type { Described } from './store.js';

/**
 * The question asked before any pixel is paid for: does this subject need an
 * image at all?
 *
 * Its own file, in the package that owns `RasterStore`, because it is the
 * economy every composition rests on — the binary, a Playwright fixture, a jest
 * matcher. It lived in `packages/cli` until 2026-08-04, where the one query that
 * decides whether a run pays for an image was reachable only by spawning the
 * binary, and every other surface either reimplemented it or went without.
 * Rasterization costs ~65ms against ~3.4ms for a semantic collection of the same
 * page (ADR-0010), and a suite is three hundred subjects of which two changed —
 * so the value of `variance run` is almost entirely the value of the answers
 * below. A reader auditing that claim should be able to read the argument without
 * reading the loop that acts on it.
 */

/**
 * What the cheap tiers concluded about one subject before any pixel was paid for.
 */
export type Settlement =
  | {
      readonly kind: 'settled';
      readonly verdict: 'unchanged' | 'incomparable';
      readonly because: string;
      /**
       * Fonts the renderer lacked when the baseline was painted.
       *
       * Carried out of the baseline because the digest short-circuit produces no
       * `Observation` to carry it, and the record would otherwise state less than
       * the store already knows. Absent means the baseline recorded none, never
       * "this path does not look" — see the copy in {@link settle}.
       */
      readonly missingFonts?: readonly string[];
    }
  | { readonly kind: 'render'; readonly because: string };

/**
 * Decide whether this subject needs an image, from the baseline alone.
 *
 * Three answers, and the first is the one that pays for this whole design.
 *
 * **The document digest matches.** `documentDigest` covers the markup, the
 * applicable CSS in cascade order, the frame, the inherited floor, the viewport
 * including its scale factor, and the declared fonts — that is, everything sent
 * to a renderer. The baseline's sidecar records which digest it was painted from.
 * If they are equal and `comparable` says one machine painted both, then painting
 * it again is a function applied twice to the same input. The texture band is
 * settled without a browser touching it.
 *
 * *What that costs.* It assumes the renderer is deterministic given a document
 * and an identity. A page with a CSS animation, a video frame, or a `Math.random`
 * background defeats it — and defeats a re-render too, which would report a
 * change with no cause. That is the `unexplained` verdict's territory, and it is
 * not made worse here; but a suite full of animation will settle to `unchanged`
 * on inputs that genuinely repaint differently, and the honest place to fix that
 * is the document, with `AssembleOptions.extraCss`.
 *
 * **The baseline is another machine's.** Refused rather than rendered. Producing
 * the image would buy a diff nobody is permitted to read, since pixels are
 * machine-bound and the difference would be attributed to whichever component
 * happens to sit under it (ADR-0011).
 *
 * **Anything else renders.** Including `new`, where the *verdict* is already
 * settled — there is no baseline, and no image changes that. It renders anyway,
 * and this is the one place the run pays for a render it does not need for the
 * verdict: without the image there is nothing for `accept` to promote, and
 * `accept` is forbidden to re-run. Stated here rather than hidden, because it is
 * the single exception to the rule this function otherwise enforces.
 *
 * ## Why this takes a `Described` and not a `Found`
 *
 * `RasterStore.describe` answers the digest question from the sidecar alone,
 * without base64-encoding a PNG to make a string comparison — which is the whole
 * of what every branch here needs, and on a three-hundred-subject suite is the
 * difference between a few hundred kilobytes and a few hundred megabytes. Across
 * a hop it is that difference twice.
 *
 * This function took the expensive `Found` until `Described` gained
 * `missingFonts`, and the reason was exactly one field: settling on a digest
 * match while dropping the fonts the baseline was painted without reports a
 * substituted typeface as a bare `unchanged` — true about the pixels, and a lie
 * about the subject. That is now the fourth field of `Described`, every backend
 * supplies it out of a sidecar it was already reading, and a transport that
 * omits it fails rather than defaulting.
 *
 * *What the caller still pays.* This is not a cheaper `find`; it cannot say what
 * changed, only whether anything could have. A subject that does **not** settle
 * needs the image after all, so its run does one sidecar read *and* the lookups
 * it always did. The trade is deliberate and it is a bet on the common case: a
 * suite where nothing moved now reads no PNG at all, and a suite where
 * everything moved does strictly more work than before.
 */
export function settle(
  digest: Digest,
  found: Described | null,
  /**
   * The identity this run would paint under.
   *
   * Required so the refusal can name *both* sides. A sentence that says a
   * baseline is not comparable while describing only the baseline gives the
   * reader one machine and asks them to guess what the other one is — and when
   * the difference is in a field the description omits, the two sides read
   * identically. See `describeIdentity`.
   */
  mine?: RenderIdentity,
): Settlement {
  if (found === null) {
    return {
      kind: 'render',
      because: 'no baseline exists, so there is no digest to compare this document against',
    };
  }

  if (!found.comparable) {
    return {
      kind: 'settled',
      verdict: 'incomparable',
      because:
        `a baseline exists but was rendered by ${describeIdentity(found.storedUnder)}` +
        (mine === undefined ? '' : `, and this run is ${describeIdentity(mine)}`) +
        '; pixels are machine-bound, so the two are not comparable and no image was produced',
    };
  }

  if (found.documentDigest === digest) {
    // The digest is a statement about pixels and about nothing else. A baseline
    // painted while the renderer lacked a declared font is an image of a
    // substituted font, and repainting the same document would substitute it
    // again — which is exactly why this returns `unchanged` and exactly why it
    // may not return a *bare* `unchanged`. The store recorded the substitution;
    // dropping it here would leave the reader with a sentence saying the subject
    // is fine, produced by a comparison that never looked at the typeface.
    const missingFonts = found.missingFonts;

    return {
      kind: 'settled',
      verdict: 'unchanged',
      because:
        'the document this run assembled is byte-identical to the one the baseline was ' +
        'painted from, under the same renderer identity, so no image was produced' +
        (missingFonts.length > 0
          ? `; the renderer lacked ${missingFonts.join(', ')} when the baseline was painted, ` +
            'so what is settled is an image of a substituted font'
          : ''),
      ...(missingFonts.length > 0 ? { missingFonts } : {}),
    };
  }

  return {
    kind: 'render',
    because: 'the document differs from the one the baseline was painted from',
  };
}
