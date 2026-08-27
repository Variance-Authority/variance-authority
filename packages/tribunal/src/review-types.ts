import type { AccessibilitySnapshot, RenderIdentity } from '@variance-authority/core';
import type {
  FindingRecord,
  NotObserved,
  ObservationRecord,
  RegionRecord,
  RunReport,
} from '@variance-authority/report';
import type { TribunalBindings } from './bindings.js';

/**
 * What a review store takes and what it answers with — and nothing that runs.
 *
 * The vocabulary rather than the implementation, apart from it because three
 * other module graphs need the words without the machinery: `worker-input.ts`
 * types the request bodies it validates against these, `ui/client.ts` types its
 * responses against them, and the React surface renders them. None of those
 * should have to name a D1 binding to say what a `BuildSummary` is.
 *
 * The arguments that produced these shapes are on the shapes, because that is
 * where somebody about to change one will look. Why the store *behaves* as it
 * does is in [`review.ts`](./review.ts).
 */

export interface ReviewOptions extends TribunalBindings {
  readonly project: string;
  /** Injected so tests can pin every `at`. Defaults to the wall clock. */
  readonly now?: () => Date;
}

/** One image the run kept, as it arrives. */
export interface CandidateImage {
  /** Base64 PNG — the same encoding a `Raster` carries, for the same reason. */
  readonly bytes: string;
}

/**
 * What a run produced for one subject, over and above the report's record of it.
 *
 * `after` is the candidate and is the only one that can be promoted, which is why
 * it alone carries the sidecar fields. `before` and `diff` exist to be looked at.
 */
export interface SubjectImages {
  readonly after?: CandidateImage & {
    readonly documentDigest: string;
    readonly width: number;
    readonly height: number;
    readonly missingFonts: readonly string[];
    readonly accessibility?: AccessibilitySnapshot;
  };
  readonly before?: CandidateImage;
  readonly diff?: CandidateImage;
}

export interface BuildIngest {
  /** The operator's own id for the run — a CI job number, a workflow run id. */
  readonly build: string;
  readonly commit: string;
  readonly branch?: string;
  readonly report: RunReport;
  /** Keyed by subject. A subject with no entry is recorded with no images. */
  readonly images?: Readonly<Record<string, SubjectImages>>;
}

import type { TribunalChangelog, TribunalChangelogQuery } from './changelog.js';

export type Decision = 'approved' | 'rejected';

export interface DecisionRecord {
  readonly decision: Decision;
  readonly by: string;
  readonly note?: string;
  readonly at: string;
}

export interface BuildSummary {
  readonly project: string;
  readonly build: string;
  readonly commit: string;
  readonly branch?: string;
  readonly intent?: string;
  readonly at: string;
  readonly identity: RenderIdentity;
  readonly retention: 'durable' | 'ephemeral';
  /** One entry per verdict the report used, including the ones with no subjects. */
  readonly verdicts: Readonly<Record<ObservationRecord['verdict'], number>>;
  readonly decided: number;
  /** Subjects whose verdict needs review and that nobody has decided yet. */
  readonly pending: number;
  readonly coverage: Coverage;
}

/**
 * What the run said about the subjects it did not observe.
 *
 * `stated: false` is the whole reason this is a shape rather than two numbers. A
 * summary that showed `failed: 0` for a report that never carried the list would
 * be asserting coverage on the authority of a writer that declined to claim any.
 */
export interface Coverage {
  readonly stated: boolean;
  readonly failed: number;
  readonly excluded: number;
}

export interface SubjectView {
  readonly subject: string;
  readonly verdict: ObservationRecord['verdict'];
  readonly because: string;
  readonly changedPixels: number;
  readonly regions: readonly RegionRecord[];
  readonly truncated?: { readonly regions: number; readonly pixels: number };
  readonly missingFonts?: readonly string[];
  readonly findings?: readonly FindingRecord[];
  readonly signals?: ObservationRecord['signals'];
  /** Which images this build kept. Absent means the run did not save one. */
  readonly has: { readonly before: boolean; readonly after: boolean; readonly diff: boolean };
  /**
   * The candidate's dimensions, when it kept one.
   *
   * Carried so a viewer can place region rectangles over the image without
   * measuring it in the browser first. Region coordinates are in the raster's own
   * pixel space; a viewer that scaled them by a measured `naturalWidth` would draw
   * the boxes in the right place only after the image had loaded, and in the wrong
   * place for one frame before that.
   */
  readonly size?: { readonly width: number; readonly height: number };
  /** `true` when the candidate carries the sidecar an approval would promote. */
  readonly approvable: boolean;
  readonly decision: DecisionRecord | null;
}

/**
 * A build, and the docket a reviewer reads.
 *
 * `causes` is the ordering the incumbent comparison gets backwards. Ranked by
 * area, a component that only *reflowed* outranks the component that was edited —
 * measured at 6× on one edit — so the docket is grouped by the components the
 * semantic tier named as causes, and collateral is counted rather than listed.
 * One token change across 300 subjects is one review item with a count, never 300
 * lines.
 */
export interface BuildDetail extends BuildSummary {
  readonly subjects: readonly SubjectView[];
  readonly notObserved: readonly NotObserved[];
  readonly causes: readonly Cause[];
}

export interface Cause {
  readonly component: string;
  readonly file?: string;
  readonly subjects: readonly string[];
  readonly pixels: number;
  /** Regions in the same builds that no component claimed as a cause. */
  readonly collateralPixels: number;
}

export interface SweepReport {
  /** Builds removed. */
  readonly builds: number;
  /** Subject rows removed with them. */
  readonly subjects: number;
  /** Stored images removed with them. */
  readonly objects: number;
  /**
   * Decisions those builds carried, which are **kept**, not removed.
   *
   * Named for what happened to them, because every other number here is a
   * removal and an operator reading `decisions: 4` beside them concludes four
   * approvals were deleted — the one thing this store promises never happens
   * ([ADR-0021](../../../docs/context/adr/0021-approval-promotes-an-image-that-already-exists.md)).
   * The count is worth reporting: it is how much attribution outlived the build
   * that proposed it, and a sweep that returned zero here forever would be a
   * retention policy quietly disagreeing with the trigger on the table.
   */
  readonly decisionsKept: number;
}

export interface ReviewStore {
  ingest(build: BuildIngest): Promise<void>;
  builds(limit?: number): Promise<readonly BuildSummary[]>;
  build(id: string): Promise<BuildDetail | null>;
  image(build: string, subject: string, kind: 'before' | 'after' | 'diff'): Promise<ArrayBuffer | null>;
  decide(input: {
    readonly build: string;
    readonly subject: string;
    readonly decision: Decision;
    readonly by: string;
    readonly note?: string;
  }): Promise<DecisionRecord>;
  /**
   * Why the baselines are what they are — every approval, grouped by what changed.
   *
   * Deliberately not derived from `builds`: those expire, and a baseline's
   * explanation has to outlive the build that proposed it by as long as the
   * baseline lasts. See [`changelog.ts`](./changelog.ts).
   */
  changelog(query?: TribunalChangelogQuery): Promise<TribunalChangelog>;
  /**
   * Remove builds older than `keepDays`, and everything that hangs off them.
   *
   * `decisions` and `changelog` are not among them, and both carry a permanence
   * trigger saying so: a promoted baseline whose approval was swept is a change
   * nobody can attribute to anyone, and one whose changelog entry was swept is a
   * baseline nobody can account for.
   */
  sweep(keepDays: number): Promise<SweepReport>;
}
