/**
 * The verdict model (spec §7).
 *
 * A verdict is the system's only output that anyone acts on. Everything upstream
 * — snapshots, diffs, bands, attribution — exists to produce one of these six
 * words with a defensible reason attached.
 */

export type Verdict =
  /** Hash hit, or never reachable from the change. */
  | 'unchanged'
  /** Fully explained by an adjudication that already happened upstream. */
  | 'inherited'
  /** Matches declared intent, or policy auto-approves this band. */
  | 'authorized'
  /** Band and policy require a human to sign off. One action per root. */
  | 'needs-review'
  /** Policy forbids it. An agent must fix this before opening a PR. */
  | 'violation'
  /**
   * Raster residue with no semantic cause. The highest severity in the system.
   *
   * Inverted relative to pixel-diff tools, and deliberately so (spec §1): a
   * change the pipeline cannot explain means provenance failed, so the tool has
   * lost the thread rather than found a small problem.
   */
  | 'unexplained';

/**
 * A band the acting profile could not observe.
 *
 * Not a verdict, and never collapsed into one. A tier that cannot see a band must
 * say so rather than pass it (ADR-0002); folding this into `unchanged` is exactly
 * the false-negative the profile system exists to prevent.
 */
export const UNOBSERVED = 'unobserved' as const;

export type BandOutcome = Verdict | typeof UNOBSERVED;

/** Ordered by severity. Later entries win when a subject carries several. */
const SEVERITY: readonly Verdict[] = [
  'unchanged',
  'inherited',
  'authorized',
  'needs-review',
  'violation',
  'unexplained',
];

export function severityOf(verdict: Verdict): number {
  return SEVERITY.indexOf(verdict);
}

/** Whether a verdict should fail CI. Policy may promote, never demote. */
export function blocks(verdict: Verdict): boolean {
  return verdict === 'violation' || verdict === 'unexplained' || verdict === 'needs-review';
}
