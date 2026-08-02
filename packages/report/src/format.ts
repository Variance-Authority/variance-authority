import type { RenderIdentity } from '@variance-authority/core';

/**
 * The run report — the artifact an agent actually reads.
 *
 * The observation pipeline produces values in memory and then the process ends.
 * That is fine for a test and useless for the thing this is for: an agent asked
 * to *fix* something arrives afterwards, in a different process, with no access
 * to whatever was in scope when the change was sensed.
 *
 * So the run writes one of these, and the MCP tools query it. Keeping the file
 * the contract — rather than having the tools re-run the pipeline — is what makes
 * the two halves independent: a run can be produced by CI on a pinned machine
 * and queried on a laptop, and the tools can be tested against a report nobody
 * rendered.
 *
 * Deliberately not the raw `Observation`. That carries a `ChangeMask` and base64
 * PNGs, which would make a 300-subject report hundreds of megabytes of data no
 * reader ever looks at. What is kept is what a sentence needs.
 */

export interface RunReport {
  readonly runVersion: 1;
  /** ISO 8601. Supplied by the caller — nothing in this package reads a clock. */
  readonly at: string;
  readonly identity: RenderIdentity;
  readonly retention: 'durable' | 'ephemeral';
  /** What the run was comparing, in the author's words. Carried into every answer. */
  readonly intent?: string;
  readonly observations: readonly ObservationRecord[];
  /**
   * Subjects the run planned and has no observation for. **Absent is not empty.**
   *
   * Lives here rather than only on the CLI's own superset because the answers an
   * agent gets are computed from *this* type, and a field the tools cannot see is
   * a field the tools cannot be contradicted by. A run that planned 300 subjects,
   * failed on 50 and found the other 250 unchanged produces a report in which
   * every observation is clean and the conclusion "nothing to review" is false;
   * the only thing that can refuse that sentence is this list.
   *
   * Optional because a report written by something other than `variance run` will
   * not carry it, and the difference has to survive: `undefined` means the writer
   * never said what it skipped, which is not the same claim as "it skipped
   * nothing" and must never be printed as one. Costs every reader an extra state
   * to handle, which is cheaper than the state it prevents collapsing.
   */
  readonly notObserved?: readonly NotObserved[];
}

/**
 * Why a subject is in the report without an observation.
 *
 * Two kinds, kept apart because they mean opposite things about whether anyone
 * should act. `excluded` is a decision the operator already made and wrote down;
 * `failed` is a hole in this run's coverage. Collapsing them would either make
 * every configured exclusion permanently red — which ends with the exclusion list
 * being deleted rather than read — or make a browser that crashed on subject 41
 * look like a subject somebody chose to skip.
 */
export type NotObservedKind = 'excluded' | 'failed';

export interface NotObserved {
  readonly subject: string;
  readonly kind: NotObservedKind;
  /** One sentence, ready to print, naming what was not looked at and why. */
  readonly because: string;
}

export interface ObservationRecord {
  readonly subject: string;
  readonly verdict: 'unchanged' | 'changed' | 'new' | 'incomparable';
  readonly because: string;
  /** Differing pixels at the policy the run isolated on. */
  readonly changedPixels: number;
  readonly regions: readonly RegionRecord[];
  /** Regions found but not recorded, with their pixels. Never silently dropped. */
  readonly truncated?: { readonly regions: number; readonly pixels: number };
  readonly missingFonts?: readonly string[];

  /**
   * Defects found in *this* render, with no baseline consulted.
   *
   * The other half of what a run knows, and the half a comparison structurally
   * cannot produce: a control that never had an accessible name compares equal
   * to itself forever, so approving the first baseline approves the defect.
   * Recorded per subject rather than per run because they are attributed the
   * same way a region is — a component, a place, a file — and because the same
   * component appearing in six subjects is six chances to notice it.
   *
   * They do not affect the verdict. A tool that blocks a merge on day one over
   * findings nobody asked for gets switched off in week one; a project that
   * wants them enforced writes `blocking: ['a11y']` in its policy, which covers
   * both these and the regressions found by comparison.
   *
   * **Empty is not absent.** `[]` means this render was inspected and was clean;
   * omitted means nothing inspected it, because the collector supplied no
   * snapshot. Printing the second as the first tells a reader the component is
   * fine on the authority of something that never looked at it — the same
   * collapse `notObserved` exists to prevent.
   */
  readonly findings?: readonly FindingRecord[];
  /** Where the images went, when the run kept them. Relative to the report. */
  readonly images?: {
    readonly before?: string;
    readonly after?: string;
    readonly diff?: string;
  };
}

/**
 * One defect in a render, flattened for the report.
 *
 * Same fields a `RegionRecord` carries and for the same reason: what, where,
 * whose, which file. The owner chain is dropped — it is an in-memory structure
 * with a props digest per frame, and a report is read by something that wants a
 * sentence.
 */
export interface FindingRecord {
  /** e.g. `control-without-name`. Stable, so an ignore list can name one. */
  readonly rule: string;
  /** One sentence, naming the thing rather than the rule. */
  readonly what: string;
  readonly path: string;
  /** Landmark phrase, e.g. `main → list item 2 of 3`. */
  readonly where?: string;
  readonly component?: string;
  readonly file?: string;
}

export interface RegionRecord {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly component?: string;
  readonly path?: string;
  /** Landmark phrase, e.g. `main → list item 2 of 3`. */
  readonly where?: string;
  readonly file?: string;
  /**
   * `true` when the semantic tier named this component a root of the change.
   *
   * The field that decides whether a report leads with the edit or with what the
   * edit pushed around. See `rankRegions` — area alone gets this backwards.
   */
  readonly cause: boolean;
  /** `true` when no box contained the region; a wrong scale or origin. */
  readonly unattributed?: boolean;
}
