import type { Band, DeltaKind } from '../band.js';
import type { Rect } from '../capture.js';
import type { NodePath } from '../snapshot.js';
import type { OwnerFrame } from '../provenance.js';

/**
 * A single observed difference.
 *
 * Deltas are the atoms the docket is assembled from. Each one already knows its
 * band and its owner chain when it is created — Principle 5 says causality flows
 * forward, so a change must arrive carrying its name rather than having one
 * reconstructed for it later.
 */
export interface Delta {
  readonly kind: DeltaKind;
  readonly band: Band;

  /** Path in the *candidate* tree, or the baseline tree for a removal. */
  readonly path: NodePath;

  /** Which property, attribute, or ARIA state moved. Absent for whole-node deltas. */
  readonly property?: string;

  /**
   * Explicitly `| undefined`, unlike most optional fields in this codebase.
   *
   * A delta routinely has a value on one side only — an attribute that appeared,
   * a role that was removed — and "absent on this side" is the meaning being
   * recorded, not a field the author forgot. Forcing callers to omit the key
   * instead would make every comparison site build its object conditionally to
   * express something the type can say directly.
   */
  readonly from?: string | undefined;
  readonly to?: string | undefined;

  /** Owner chain at the changed node, innermost first. */
  readonly owners?: readonly OwnerFrame[];

  /**
   * Custom property the changed value resolved through.
   *
   * Present only when the token's own value moved. A node whose colour changed
   * because `--color-primary` changed is collateral of one token edit; a node
   * whose colour changed while every token held is a root in its own right.
   * Distinguishing the two is the entire job of the docket.
   */
  readonly token?: string;

  /** Nearest ARIA landmark, so location reads as "right panel", not coordinates. */
  readonly region?: string;

  readonly rectFrom?: Rect;
  readonly rectTo?: Rect;
}

/**
 * What explains a group of deltas.
 *
 * The docket presents one entry per root (spec §6.2): *root cause, band, count
 * of collateral, sample subjects, owner chain* — and approving it MUST be one
 * action. "1 token change, 300 collateral, structure intact" is one review item.
 */
export interface Root {
  /** Stable across builds, so an approval recorded against it keeps applying. */
  readonly id: string;
  readonly kind: RootKind;
  readonly label: string;
  readonly band: Band;
  readonly deltas: readonly Delta[];
}

export type RootKind =
  /** A design token's value moved. Every affected node is collateral. */
  | 'token'
  /** A component changed internally, with its incoming props unchanged. */
  | 'component'
  /** A component's incoming props changed; the root is upstream of it. */
  | 'prop'
  /** A render input that is not code: engine, fonts, viewport, ruleset. */
  | 'environment'
  /**
   * No owner could be determined.
   *
   * Not a filler category. Provenance is supposed to make every change
   * nameable, so an unattributed root means the chain broke — which is a defect
   * in this tool, not a property of the change, and it is surfaced rather than
   * quietly absorbed into a neighbouring root.
   */
  | 'unattributed';

export function deltaSignature(delta: Delta): string {
  return `${delta.kind}:${delta.path}:${delta.property ?? ''}`;
}
