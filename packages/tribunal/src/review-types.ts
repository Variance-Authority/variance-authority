import type { AccessibilitySnapshot, RenderIdentity } from '@variance-authority/core';
import type {
  FindingRecord,
  IgnoreLedger,
  NotObserved,
  ObservationRecord,
  ReachHole,
  ReachedComponent,
  RegionRecord,
  RunReport,
  SensitivityLedger,
  SubjectReach,
  VariationRecord,
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
  /**
   * The baseline this run compared against, with its own dimensions when they
   * could be read.
   *
   * Optional, and absent means *not measured* — never *the same size as the
   * candidate*. That assumption is the thing this field exists to stop: a
   * baseline drawn to the candidate's box is a width change resampled out of
   * existence, on the one screen where somebody decides whether it is allowed.
   */
  readonly before?: CandidateImage & {
    readonly width?: number;
    readonly height?: number;
  };
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
  /**
   * What the operator's ignores took out of this comparison, as the run wrote it.
   *
   * Carried per subject even though the build also carries a ledger, because the
   * two answer different questions. The ledger says a rule absorbed 647 pixels
   * somewhere; this says it absorbed them *here*. A settled list built from the
   * ledger alone can only say a declaration decided this subject, which is the
   * sentence a reviewer already read in the verdict.
   */
  readonly ignored?: ObservationRecord['ignored'];
  /** The sensitivity that decided this subject, when one did. */
  readonly relaxed?: ObservationRecord['relaxed'];
  /**
   * Which components moved here per their hashes, and in which bands.
   *
   * The half of the record {@link SubjectView.regions} cannot carry. A region is
   * named from where its box landed, so an edit that reflowed its neighbours
   * arrives as one blob attributed to the document root; these entries compared
   * digests and never saw a pixel, so they still hold the component and the
   * sense. Absent means the baseline carried no hashes — never that nothing
   * moved.
   */
  readonly moved?: ObservationRecord['moved'];
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
  /**
   * The baseline's own dimensions, when the run measured them.
   *
   * Separate from {@link SubjectView.size} rather than folded into it, because
   * the two being different is a finding. A viewer that had only one pair would
   * have to draw both layers to it, and a capture that grew by 40 pixels of
   * width would read as identical everywhere except a hairline at the edge.
   */
  readonly baseline?: { readonly width: number; readonly height: number };
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
  /**
   * What the run read about its own subjects — the section with no baseline in it.
   *
   * Beside `causes` and not among them, because these are not changes and must
   * never be counted as any: a variation is a difference somebody meant. It is
   * here because it answers the question a docket cannot. A subject added behind
   * a flag is `new`, its diff is empty, and what the flag *does* is visible only
   * by opening two pictures side by side — which is the review nobody performs.
   * The run already compared the pair, so the answer is carried rather than
   * looked for.
   *
   * Empty when the report declared none. `VariationRecord` unchanged from the
   * report's, because a store that reshaped it would be a second vocabulary for
   * one fact.
   */
  readonly variations: readonly VariationRecord[];

  /**
   * What the commit reaches, and per subject whether it reaches that one.
   *
   * `null` when the run carried no diff — no ref to read against, or no file
   * graph to walk — which is different from a diff that reached nothing and is
   * shown as different.
   *
   * The four states a reviewer actually reads are not stored anywhere. They are
   * this crossed against the verdicts already in `subjects`, and two of them are
   * questions no comparison can pose on its own: a subject the commit reaches
   * that did not move, and a subject that moved with nothing in the commit
   * reaching it.
   */
  readonly reach: ReachView | null;

  /**
   * What the config declared, and what each declaration did in this run.
   *
   * The audit surface, carried across the boundary rather than left in a CI log.
   * A mask that outlived its cause is only ever found by comparing runs — *this
   * rule absorbed nothing again* — and a review service that dropped the ledger
   * could show the question but never the answer.
   */
  readonly declarations: Declarations;

  /**
   * Who draws what, over the whole suite.
   *
   * `null` when the report carried no composition — a raster-only run has no
   * boundaries to join. Empty is never written and would say something else
   * entirely: that the run read its subjects and found no component in them.
   */
  readonly composition: readonly Placement[] | null;

  /**
   * What the run concluded about each thing that moved, in component order.
   *
   * The census above is the graph; this is the reading of it. A review page can
   * derive neither: the run had the diff, the source index that maps a component
   * to the file declaring it, the props digest each rendering was grouped under,
   * and the subjects where the same component with the same props held still.
   * None of those cross the wire, and a page that tried to re-derive the answer
   * from `composition` and `reach` alone would be guessing at the one question a
   * reviewer opens a change to ask.
   *
   * Empty when the store holds none, which includes a build ingested before this
   * was carried. So it is read as *no attribution is on record*, and nothing
   * downstream may turn it into *the run examined this and found no cause*.
   */
  readonly movements: readonly MovementView[];
}

/**
 * Why one component moved in one subject, as the run decided it.
 *
 * `MovementRecord` from the report, minus `alsoIn` — which is the subjects of
 * every sibling row for the same component, and a stored copy of it is a second
 * answer able to disagree with the first.
 *
 * The pair is the key. A component moves for its own reason in each subject it
 * moved in: the same `Button` is `edited` on the page whose file the diff names
 * and `upstream` on the one where a changed parent hands it different props.
 */
export interface MovementView {
  readonly subject: string;
  readonly component: string;
  readonly cause: 'edited' | 'token' | 'upstream' | 'contradicted' | 'unexplained';
  /** One sentence, naming the evidence rather than the category. */
  readonly because: string;
  /** Empty means *not known* — a name-only comparison — never *no band*. */
  readonly bands: readonly string[];
  /** Subjects where the same component, with the same props, held still. */
  readonly held: readonly string[];

  /** The file the diff named, on the `edited` rung. */
  readonly file?: string;
  /** The custom properties that took a new value, on the `token` rung. */
  readonly tokens?: readonly string[];
  /** The edited component that reaches this one, on the `upstream` rung. */
  readonly upstream?: string;
  /** Components between `upstream` and this one, outermost first. */
  readonly through?: readonly string[];
  /** On an unexplained movement: whether the subject was already proven unstable. */
  readonly standing?: 'flake' | 'suspect';
}

/**
 * The two ledgers as this store holds them.
 *
 * `null` is *the report carried none*, and it is deliberately one state rather
 * than two. On this format a config with no ignores and a writer that never kept
 * a ledger produce the same absence, so a store that offered two answers would
 * be inventing the difference. What it must not do is answer with an empty
 * ledger, which would report an unaudited build as one that was audited and
 * found clean.
 */
export interface Declarations {
  readonly ignores: IgnoreLedger | null;
  readonly sensitivities: SensitivityLedger | null;
}

/**
 * Where one component sits in the suite, as the run's census recorded it.
 *
 * The other direction from {@link ReachView}, and the page needs both. Reach
 * climbs: from a file the diff named, through its importers, to the components
 * an edit could have arrived at. It can therefore never name anything a changed
 * file *draws* — `ProductCard` renders `Card`, `Card` renders `CardFooter`, and
 * an upward walk arrives at none of them. That is why a build page could count
 * the components no rung held and could not say why any of them moved.
 *
 * Nothing here is measured for the tribunal. It is `composition.components` from
 * the report, narrowed to the three edges a sentence needs.
 */
export interface Placement {
  readonly component: string;
  /** Subjects holding at least one boundary of it, in plan order. */
  readonly subjects: readonly string[];
  /** Components that enclose it somewhere in the suite, sorted. */
  readonly within: readonly string[];
  /**
   * Components that mounted it somewhere, sorted.
   *
   * Empty on a production build, where React keeps no `_debugOwner` — and empty
   * is **not** *nothing mounted it*. The report's own field carries the same
   * ambiguity and the store does not resolve it, because resolving it here would
   * be a claim about a build this service never saw.
   */
  readonly createdBy: readonly string[];
  /** Components it encloses somewhere, sorted. */
  readonly renders: readonly string[];
}

/**
 * The reach section as the page reads it.
 *
 * `subjects` absent is the run saying it had a diff and could not attribute it,
 * with `whole` carrying the reason. Empty would say the commit was understood and
 * reaches none of them, and a page that drew the second when it held the first
 * would let somebody merge on a refusal.
 */
export interface ReachView {
  readonly against: string;
  readonly changed: readonly string[];
  readonly components: readonly ReachedComponent[];
  readonly subjects?: Readonly<Record<string, SubjectReach>>;
  readonly whole?: string;
  readonly unscanned?: readonly string[];
  readonly opaque?: readonly ReachHole[];
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
