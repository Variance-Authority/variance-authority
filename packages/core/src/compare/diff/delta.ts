import type { Band, DeltaKind } from '../band.js';
import type { AggregateImpact, PropertyImpact } from '../impact.js';
import type { Rect } from '../../format/capture.js';
import type { NodePath } from '../../format/snapshot.js';
import type { OwnerFrame } from '../../format/provenance.js';

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
   * The component whose JSX created this element.
   *
   * Distinct from `owners[0]`, which is the nearest *enclosing* component, and
   * the two diverge exactly where structural attribution needs them to. When a
   * list reorders, the nodes that moved are `Chip`s enclosed by a `Stack` — but
   * neither decided the order. The component that wrote the JSX did, and this is
   * the only field that names it.
   */
  readonly createdBy?: string;

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

  /**
   * Where this is, spoken outside-in: `main → region "Todos" → list item 2 of 3`.
   *
   * A path is an address and a rect is a coordinate; neither survives the next
   * reflow or tells anyone where to look. See `locate.ts`.
   */
  readonly where?: string;

  readonly rectFrom?: Rect;
  readonly rectTo?: Rect;

  /**
   * How far this change can reach: reflow, repaint, or compositing.
   *
   * Absent for structural deltas, where the question does not apply. See
   * `impact.ts` — the useful consequence is that a paint-only change has no
   * geometric collateral, which lets a profile with no layout engine rule out
   * movement rather than merely failing to observe it.
   */
  readonly impact?: PropertyImpact;

  /**
   * Set on a delta that is a *consequence* of another on the same node.
   *
   * A rect that moved because padding changed is not an independent finding —
   * it is the padding change, observed a second way. Without this the docket
   * reports one edit twice, once as `token` and once as `geometry`, and a
   * reviewer has to work out that they are the same thing.
   */
  readonly derivedFrom?: string;
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

  /**
   * Whether this root can move things, or only repaint them.
   *
   * The first question a reviewer asks about a design-system change, and the one
   * that decides whether the blast radius needs looking at.
   */
  readonly impact: AggregateImpact;

  readonly deltas: readonly Delta[];
}

/**
 * A component implicated in a change set.
 *
 * `root` is the component the change originated in; `collateral` merely renders
 * something the change reached. Separating them is the difference between "these
 * eleven components changed" — which reads like eleven problems — and "`Button`
 * changed, and ten components render it".
 */
export interface ChangedComponent {
  readonly name: string;
  readonly role: 'root' | 'collateral';
  readonly deltaCount: number;
  readonly bands: readonly Band[];
  readonly impact: AggregateImpact;
  /**
   * Components that enclose this one where the change was observed.
   *
   * Answers "where does this show up?" — the propagation half of the spec's
   * running sentence, *`Button` (variant prop change) → propagated to `NewHero`*.
   */
  readonly renderedIn: readonly string[];
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
