/**
 * Frequency bands (spec §5).
 *
 * Every semantic delta lands in exactly one band, and the band decides how loudly
 * it is reported. The insight the bands encode: change frequency and change
 * importance are inversely correlated. An accessible name almost never moves and
 * is a defect when it does; anti-aliasing moves constantly and never matters.
 *
 * The list is ordered, loudest first, and `loudestBand` is the only thing allowed
 * to collapse a set of them. Three call sites used to hard-code their own
 * `if (bands.includes('geometry'))` ladder, which meant adding a band silently
 * demoted it below everything in every one of them.
 */

export type Band =
  /**
   * Rarest, and the one a picture cannot hold. A role, an accessible name, or an
   * ARIA state changed — what a screen reader announces moved, whether or not
   * anything was repainted.
   *
   * Split out of `geometry` deliberately. Both are low-frequency, but a box that
   * moved and a control that lost its name are different findings for different
   * readers, and folding the second into the first means the evidence this
   * project collects and no image-comparison tool has is reported under a label
   * that sounds like layout. A project can now write `blocking: ['a11y']` and
   * have an accessibility regression stop a merge on its own terms.
   */
  | 'a11y'
  /** Low frequency. Boxes appear, vanish, move, or resize; content reflows. */
  | 'geometry'
  /** Mid frequency. Style *values* moved while structure held. */
  | 'token'
  /**
   * Text moved and nothing else did.
   *
   * The highest-frequency band that is still a real change: copy edits, counts,
   * dates, translations. Quieter than `geometry` because a reviewer who is told
   * a string changed does not also need to be told a box moved — the reflow is
   * the consequence, and `geometry` outranks it exactly when the tree moved for
   * some other reason too.
   *
   * It is separated from `geometry` because it is the band a message catalogue
   * joins against. A locale run compares the same subject's `content` across two
   * languages, which is a question no baseline image can be asked.
   */
  | 'content'
  /**
   * High frequency. Sub-semantic rendering variance — anti-aliasing, sub-pixel
   * shifts, compression artifacts. Auto-passes; counted, never reviewed.
   */
  | 'texture';

/** Loudest first. `loudestBand` reads this order; nothing else may assume one. */
export const BANDS: readonly Band[] = ['a11y', 'geometry', 'token', 'content', 'texture'];

/**
 * The loudest band present, or `null` for an empty set.
 *
 * `null` rather than a default, because "nothing changed" and "something changed
 * at the quietest band" are different states and a caller that wants to conflate
 * them should have to say so.
 */
export function loudestBand(bands: Iterable<Band>): Band | null {
  const present = new Set(bands);
  return BANDS.find((band) => present.has(band)) ?? null;
}

/** What kind of thing changed, before policy has an opinion about it. */
export type DeltaKind =
  | 'node-added'
  | 'node-removed'
  | 'node-moved'
  | 'role-changed'
  | 'name-changed'
  | 'description-changed'
  | 'state-changed'
  | 'text-changed'
  | 'attribute-changed'
  | 'rect-changed'
  | 'style-changed'
  | 'token-changed'
  | 'raster-residue';

/**
 * The band a delta falls in, before policy.
 *
 * `attribute-changed` is `geometry` rather than `a11y` for a reason that is
 * easy to get backwards: **no `aria-*` attribute ever reaches it.**
 * `ATTRIBUTE_ALLOWLIST` drops them all, because each one resolves into a field
 * of its own — `role`, `name`, `description`, `state` — and those are the four
 * kinds banded `a11y`. An `aria-*` delta arriving as `attribute-changed` would
 * mean normalization had stopped resolving it, which is a defect rather than a
 * banding question.
 *
 * Note that `rect-changed` is `geometry` while `style-changed` is `token`, even
 * though a padding change produces both. That is intended: the two are reported
 * at different bands from different evidence, and the attributor folds the rect
 * movement into the style change as collateral. Under a profile without layout
 * there is no rect evidence at all, and the style change stands alone — which is
 * why JSDOM can decide the token band but only part of geometry.
 *
 * Policy may promote or demote from here per project, subject, region, or
 * component (spec §5). This function is the default, not the answer.
 */
export function bandOf(kind: DeltaKind): Band {
  switch (kind) {
    case 'role-changed':
    case 'name-changed':
    case 'description-changed':
    case 'state-changed':
      return 'a11y';
    case 'text-changed':
      return 'content';
    case 'node-added':
    case 'node-removed':
    case 'node-moved':
    case 'attribute-changed':
    case 'rect-changed':
      return 'geometry';
    case 'style-changed':
    case 'token-changed':
      return 'token';
    case 'raster-residue':
      return 'texture';
  }
}
