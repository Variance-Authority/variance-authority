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

  /**
   * What a history record already knew about the subjects this run found
   * unstable, keyed by subject.
   *
   * Two readings put a *floor* under flakiness and can never put a ceiling on it
   * (`ObservationRecord.unstable`). This is the other instrument: how often the
   * subject has read differently before, and — the part that decides what anybody
   * does next — whether it has happened since the last few sweeps. "Unstable in 6
   * of 20" and "6 times, none in the last 9 sweeps" are opposite instructions.
   *
   * It lives on this type rather than only on the CLI's superset for the reason
   * `notObserved` does: the answers an agent gets are computed from *this* type,
   * and a field the tools cannot see is a field they cannot be contradicted by.
   *
   * **Absent is not "this has never happened."** It means no store answered —
   * because none is configured, or because one could not be reached — and the
   * reason is in `warnings` where it can be printed. A surface that renders a
   * missing entry as "first occurrence" has invented the one fact this record
   * exists to supply.
   */
  readonly flakiness?: Readonly<Record<string, FlakinessRecord>>;
}

/**
 * How often one subject has failed to read the same way twice.
 *
 * A structural copy of `@variance-authority/history`'s `Flakiness` rather than an
 * import of it: this package requires nothing, and a report reader must not have
 * to install a history client to open a file. The two are kept in step by the
 * writer — `cli`, which imports both — and the fields that could drift are the
 * ones with a rule attached, restated here so a reader of the artifact meets it.
 */
export interface FlakinessRecord {
  /** Distinct runs recorded in the window, whatever they examined. */
  readonly runs: number;

  /**
   * Distinct runs that read **every** subject twice, and the only honest
   * denominator: an ordinary run asks a subject whether it agrees with itself
   * only after calling it `changed`, so a green subject's silence in one is not
   * evidence of anything.
   */
  readonly sweeps: number;

  /** Distinct runs in which this subject read differently and was not absorbed. */
  readonly occurrences: number;

  /**
   * Runs whose instability fell entirely in bands this subject does not assert
   * on — working as declared, never a finding, counted so a rule that absorbs
   * something forever can still be asked about.
   */
  readonly absorbedRuns: number;

  /** Occurrences per sweep. **Absent when no sweep has run**, and never zero. */
  readonly rate?: number;

  /**
   * Sweeps recorded since the most recent occurrence. Counted in sweeps rather
   * than in days, so a suite that stopped running does not look increasingly
   * fixed the longer nobody looks at it.
   */
  readonly sweepsSince: number;

  /** What read differently, loudest first. Empty when nothing could be named. */
  readonly causes: readonly {
    readonly component?: string;
    readonly band?: string;
    readonly runs: number;
  }[];

  readonly firstAt?: string;
  readonly lastAt?: string;

  /** One sentence, ready to print, from the package that owns the arithmetic. */
  readonly because: string;
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

  /**
   * `ignored` is green and is not `unchanged`.
   *
   * Pixels differed and every one of them landed inside a subtree the operator
   * excluded (spec 0024). Kept as its own word so a report can be asked how much
   * of its green was earned and how much was declared — a question `unchanged`
   * absorbs and can never answer again.
   */
  readonly verdict: 'unchanged' | 'changed' | 'new' | 'incomparable' | 'ignored';
  readonly because: string;

  /**
   * Differing pixels at the policy the run isolated on, **after** exclusions.
   *
   * What was ignored is in {@link ObservationRecord.ignored} rather than folded
   * in here, so the two numbers cannot be added by accident and a subject with a
   * mask over half of it does not read as a subject that barely moved.
   */
  readonly changedPixels: number;

  /**
   * What the operator's ignores took out of this comparison.
   *
   * Present whenever the subject had an excluded subtree at all, including when
   * nothing was absorbed — `pixels: 0` with `boxes: 2` is a rule that caught
   * nothing this run, which is the state that turns an ignore into a blind spot
   * and therefore the one a report must be able to state.
   */
  readonly ignored?: {
    readonly pixels: number;
    readonly boxes: number;
    /** Boxes covering no changed pixel: the raster half of a dead ignore. */
    readonly inert: number;
    /** Pixels each rule absorbed here. A rule present with `0` caught nothing. */
    readonly byRule: Readonly<Record<string, number>>;
  };
  /**
   * The sensitivity that absorbed this subject, when one did.
   *
   * A subject reported `ignored` has two possible reasons and they are not
   * interchangeable: every differing pixel fell inside an excluded subtree, or
   * every band that moved was one this subject is not asserted on. The first is
   * in {@link ObservationRecord.ignored}; this is the second, and keeping them
   * apart is what lets a run be asked how much of its green came from a mask and
   * how much from a declared level.
   */
  readonly relaxed?: {
    readonly rule: string;
    readonly level: string;
    readonly bands: readonly string[];
  };

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

  /**
   * What a second collection, in a world nothing else had touched, said.
   *
   * Present only on a subject the run called `changed`, and only when the
   * collector can build such a world — `collectAlone` in `commands/run.ts` is
   * optional, because a collector holding one page open across every subject
   * cannot, and saying so is better than being assumed to have one.
   *
   * `reproduced: false` is the finding this whole path exists for: the change is
   * gone when nothing else has run, so the baseline was right and the *session*
   * moved this subject. That is a defect in the suite rather than in the
   * component, and it must never be promoted — see `accept`, which refuses it.
   *
   * **Absent is not `reproduced: true`.** Omitted means nothing re-collected
   * this subject, and reading that as "it reproduces" is how a false regression
   * gets promoted with a confirmation attached to it.
   */
  readonly alone?: {
    /** `true` when the difference survived a world nothing else had touched. */
    readonly reproduced: boolean;
    readonly because: string;
  };

  /**
   * The subject was read twice in one world and the two readings disagreed.
   *
   * The other second pass, and it answers the opposite question to
   * {@link ObservationRecord.alone}: that one rebuilds the world and holds time,
   * this one holds the world and lets time pass. A subject that fails this one is
   * not a change and not a leak — it is a reading that cannot be taken twice, and
   * everything the comparison said about it was said about one of the two.
   *
   * `accept` refuses it, for the reason it refuses order dependence: promoting a
   * reading that will not reproduce makes the instability the baseline, and the
   * next run compares against a coin flip somebody approved.
   *
   * **Absent means this run's two readings agreed — it does not mean stable.** A
   * subject that reads differently one time in fifty passes twice-in-a-row forty
   * nine runs out of fifty. Two readings put a floor under flakiness; nothing here
   * puts a ceiling on it, and a reader who treats the absent field as a
   * certificate has been told something this field never said. It is also absent
   * on every subject the run did not call `changed`, which is almost all of them.
   */
  readonly unstable?: {
    /**
     * Components whose own content differed between the two readings, with the
     * file that declares each one where the source index could name it.
     *
     * Empty when the collector supplied no snapshot, which is a different state
     * from *no component was responsible* — see the `because`, which says which
     * of the two it is rather than leaving an empty list to be read as an answer.
     */
    readonly components: readonly {
      readonly name: string;
      /** `file:line`. Absent when no source index resolved the name. */
      readonly file?: string;
    }[];
    /** Frequency bands the disagreement fell in, e.g. `content`, `geometry`. */
    readonly bands: readonly string[];

    /**
     * The declaration that put every band of this movement outside what the
     * subject is asserted on.
     *
     * **Present means this is not a finding.** It does not gate, `accept` does
     * not refuse it, and the summary files it under a different heading — because
     * a route declared `layout` has said, in the config, that it does not assert
     * on what the page is painted with, and a clock inside it is then a fact
     * about the page rather than a defect in it. Stability is required inside the
     * boundary the subject declares, and demanding it outside would make the
     * declaration worthless: every route-level test would go red over the exact
     * movement it was written to ignore.
     *
     * Recorded rather than dropped, for the reason `ignored` is a word of its own
     * and never `unchanged` (ADR-0026): a suite has to be answerable about how
     * much of its green came from a declaration. `bands` above still lists
     * everything that moved, so the register can say what was absorbed and by
     * which rule.
     */
    readonly absorbed?: {
      readonly rule: string;
      readonly level: string;
    };

    readonly because: string;
  };

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

  /**
   * The shape of this difference, with position and values removed.
   *
   * Printed so that writing a shape-scoped ignore is copying a digest out of the
   * report rather than deriving one. Two regions with the same fingerprint are
   * the same kind of thing happening, wherever on the canvas they landed.
   */
  readonly fingerprint?: string;
}
