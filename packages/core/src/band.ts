/**
 * Frequency bands (spec §5).
 *
 * Every semantic delta lands in exactly one band, and the band decides how loudly
 * it is reported. The insight the bands encode: change frequency and change
 * importance are inversely correlated. Structure rarely moves and matters when it
 * does; anti-aliasing moves constantly and never matters.
 */

export type Band =
  /**
   * Low frequency. Boxes appear, vanish, move, or resize; ARIA structure,
   * roles, names, or states change; content reflows.
   */
  | 'geometry'
  /** Mid frequency. Style *values* moved while structure held. */
  | 'token'
  /**
   * High frequency. Sub-semantic rendering variance — anti-aliasing, sub-pixel
   * shifts, compression artifacts. Auto-passes; counted, never reviewed.
   */
  | 'texture';

export const BANDS: readonly Band[] = ['geometry', 'token', 'texture'];

/** What kind of thing changed, before policy has an opinion about it. */
export type DeltaKind =
  | 'node-added'
  | 'node-removed'
  | 'node-moved'
  | 'role-changed'
  | 'name-changed'
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
    case 'node-added':
    case 'node-removed':
    case 'node-moved':
    case 'role-changed':
    case 'name-changed':
    case 'state-changed':
    case 'text-changed':
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
