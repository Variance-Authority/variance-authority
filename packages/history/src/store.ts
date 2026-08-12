import type { ProfileId } from '@variance-authority/core';
import type { Approval } from './approval.js';
import type { FrequencyBand, Instability } from './instability.js';
import type { Band, Observation, RunRecord, TokenValue } from './observation.js';

/**
 * The interface, and nothing behind it.
 *
 * This package holds the contract, the arithmetic, and a client. Storage lives in
 * `@variance-authority/server`, and the separation is not tidiness: the store is
 * *optional*, so every caller has to be able to hold a thing that keeps no
 * history at all (`createAbsentStore`) without a second code path. An interface
 * that could only be satisfied by a database would make "no backend" a branch in
 * every consumer, and one of those branches would eventually report zero.
 *
 * Every operation returns a small slice. Nothing here loads a whole history —
 * there is no `all()`, no cursor, and no query that grows with the age of the
 * project, because the first thing anyone would do with one is compute a number
 * this file could have computed on the server.
 */

/**
 * A slice of time, and a cap on how much of it comes back.
 *
 * `since` and `until` are ISO-8601 instants matching `Observation.at`. Commit
 * ranges are deliberately not offered: a commit range is a graph question whose
 * answer depends on the branch asking, and two branches observing different
 * hashes for one key are exactly the case this store exists to keep without a
 * merge.
 */
export interface Window {
  readonly since?: string;
  readonly until?: string;

  /**
   * Maximum rows the store may return.
   *
   * Whatever a limit excludes is *counted and reported* by every result type
   * below. A capped answer that does not say it was capped reads as a complete
   * one, and for drift that is worse than useless: the total of a truncated
   * journey is a lower bound, and a reader who does not know that treats it as the
   * amount the product moved.
   */
  readonly limit?: number;
}

/**
 * The answer when no record is being kept.
 *
 * Not an empty result, and the distinction is the whole reason the backend can be
 * optional. An agent handed an empty churn concludes the product is stable; what
 * actually happened is that nobody asked the question, and "stable" is a
 * confident answer to a question that was never asked.
 *
 * It is a separate arm of a union rather than a flag on the result so that
 * TypeScript makes the caller face it. A `kept: false` field on a `Churn` full of
 * zeroes can be ignored by accident; a union cannot be rendered without narrowing.
 */
export interface Unkept {
  readonly kept: false;
  /** One sentence, ready to print. Names the missing store, never "no drift". */
  readonly because: string;
}

/** A history answer, or the statement that no history is being kept. */
export type Answer<T> = T | Unkept;

/**
 * Narrow an answer to a real one.
 *
 * Written as "is it *not* the refusal" rather than by structurally checking the
 * result, so that a new result type cannot quietly fail the guard and be reported
 * as an absent store.
 */
export function isKept<T>(answer: Answer<T>): answer is T {
  if (answer === null || typeof answer !== 'object') return true;
  return (answer as { readonly kept?: unknown }).kept !== false;
}

/**
 * How often one component's own code changed, per band it is comparable in.
 *
 * A single number would be a lie by aggregation. `structure` compares across
 * tiers and `style` and `geometry` do not, so a blended rate for a project that
 * runs both tiers counts the same edit twice for one band and mixes two
 * incomparable observations for the others.
 */
export interface BandChurn {
  readonly band: Band;

  /**
   * Absent on `structure`, which is portable and is counted across every tier.
   * Present on `style` and `geometry`, which are only ever compared within one.
   */
  readonly profile?: ProfileId;

  /**
   * The denominator: runs in the window that could observe this band in this
   * scope, quiet ones included. Never the number of runs in which something
   * happened to change.
   */
  readonly runs: number;

  /** Runs in which this component was the cause of an approved change in this band. */
  readonly changes: number;

  /** `changes / runs`. Runs is never zero here; a scope with no runs emits no entry. */
  readonly rate: number;
}

export interface Churn {
  readonly component: string;
  readonly window: Window;

  /** Distinct runs in the window, whatever tier they ran on. */
  readonly runs: number;

  /** Distinct runs in which this component caused an approved change in any band. */
  readonly changedRuns: number;

  readonly bands: readonly BandChurn[];

  /**
   * Runs in which only this component's `geometry` moved.
   *
   * Reported, never summed. A component whose geometry moved while its own
   * structure and style held was *displaced* by an edit somewhere else, and
   * accumulating displacement reports the widest container in the application as
   * the thing that keeps changing, in every run, forever. Reporting the count
   * separately is what keeps that from looking like zero.
   */
  readonly collateralRuns: number;

  /** Runs carrying a rejected change to this component. Excluded from every rate. */
  readonly rejectedRuns: number;

  /**
   * Bounds of the changes actually counted here — approved, and caused by this
   * component. Runs in which it was merely displaced do not move them, or the
   * dates would report the last time anything near it changed.
   */
  readonly firstAt?: string;
  readonly lastAt?: string;

  /** Runs and rows the window's `limit` excluded. Zero when the answer is whole. */
  readonly omittedRuns: number;
  readonly omittedObservations: number;
}

/**
 * A token's recorded values in the window, oldest first.
 *
 * Rows are expected to come from approved runs only. `TokenValue` carries no
 * acceptance of its own — it records what a commit resolved to, and acceptance is
 * a fact about the run that proposed it — so the filter belongs to whoever joins
 * the two. An implementation that forgets it produces a journey through values
 * that were never shipped, which is the "describes the review process rather than
 * the product" failure in its most convincing form, since the numbers all look
 * real.
 */
export interface Journey {
  readonly token: string;
  readonly window: Window;
  readonly values: readonly TokenValue[];
  /** Values inside the window that `limit` excluded. Any total is a lower bound while this is above zero. */
  readonly omitted: number;
}

/**
 * Where a component appears now that it did not before.
 *
 * The question a design-system change raises and a single run cannot answer:
 * `Button` growing from 12 subjects to 40 is not a regression and is not nothing,
 * and neither the run report nor a diff has any way to see it.
 */
export interface Reach {
  readonly component: string;
  readonly window: Window;

  /** Subjects the component was observed in during the window, in first-seen order. */
  readonly subjects: readonly string[];

  /**
   * Subjects whose first-ever observation of this component falls inside the
   * window — where it arrived. Requires the store to look before `since`, which is
   * why this is a stored answer rather than something the arithmetic can derive
   * from the window's own rows.
   */
  readonly arrived: readonly string[];

  readonly omittedSubjects: number;
}

/**
 * What the record holds right now, for the run about to write.
 *
 * Both halves in one answer because the run needs them at the same moment and for
 * the same reason: it writes an observation only when a hash moved, and it can
 * only say a *token* moved by comparing what it resolved against what is
 * recorded. Two round trips for one question would be two chances for the second
 * to fail after the first succeeded.
 */
export interface Current {
  /** Latest row per `(subject, component, band, profile)` in the named subjects. */
  readonly observations: readonly Observation[];

  /**
   * Latest recorded value per token, for the whole project.
   *
   * Not scoped by subject, because a token is not: `TokenValue` records what the
   * product's `--va-space-3` resolved to, and the question it exists to answer —
   * what has this drifted to — is about the product rather than about a story.
   */
  readonly tokens: readonly TokenValue[];
}

/** One way a subject was seen to disagree with itself, and how often. */
export interface FlakyCause {
  /** Absent when the readings could not be resolved to a component. */
  readonly component?: string;
  /** The frequency band that moved: `content` is data, `geometry` is layout, `token` is style. */
  readonly band?: FrequencyBand;
  /** Distinct runs in the window in which this pairing was seen. */
  readonly runs: number;
}

/**
 * How often a subject has failed to read the same way twice.
 *
 * The instrument two readings cannot be: `unstable` in one run is a lower bound
 * by construction, and a subject that flakes one time in fifty passes it
 * forty-nine runs out of fifty. What makes this actionable rather than merely
 * interesting is the pair of numbers at the end — how often, and *whether it has
 * happened since* — because "unstable in 6 of 20" and "6 times, none in the last
 * 9 sweeps" are opposite instructions to the person reading them.
 */
export interface Flakiness {
  readonly subject: string;
  readonly window: Window;

  /** Distinct runs recorded in the window, whatever they examined. */
  readonly runs: number;

  /**
   * Distinct runs that read **every** subject twice.
   *
   * The only honest denominator. A normal run asks a subject whether it agrees
   * with itself only after calling it `changed`, so a green subject's silence in
   * such a run is not evidence of anything (`RunRecord.swept`).
   */
  readonly sweeps: number;

  /** Distinct runs in which this subject read differently and it was not absorbed. */
  readonly occurrences: number;

  /**
   * Runs whose instability fell entirely in bands this subject does not assert
   * on. Working as declared: never a finding, never gating, counted so that a
   * rule absorbing something forever can still be asked about.
   */
  readonly absorbedRuns: number;

  /**
   * Occurrences per sweep. **Absent when no sweep has run**, never zero — a rate
   * over a denominator nobody asked is the confident answer to an unasked
   * question this package exists to refuse.
   */
  readonly rate?: number;

  /**
   * Sweeps recorded since the most recent occurrence. The resolution signal, and
   * the reason it is counted in sweeps rather than in days: a suite that stopped
   * running would otherwise look increasingly fixed the longer nobody looked.
   */
  readonly sweepsSince: number;

  /** What read differently, loudest first. Empty when nothing could be named. */
  readonly causes: readonly FlakyCause[];

  readonly firstAt?: string;
  readonly lastAt?: string;
  readonly lastRun?: string;

  readonly omittedRuns: number;
  readonly omittedOccurrences: number;
}

export interface HistoryStore {
  /**
   * Write one run: the run itself, the rows whose hashes moved, and the token
   * values it resolved.
   *
   * The run is a required argument rather than something inferred from the rows,
   * because a run in which nothing changed has no rows and is exactly the run that
   * must not be lost. Spec 0002 writes this as `record(observations, tokens)`,
   * which cannot express a quiet run at all — the deviation is deliberate and is
   * the only way rule "quiet runs are recorded" is implementable.
   */
  record(
    run: RunRecord,
    observations: readonly Observation[],
    tokens: readonly TokenValue[],
    /**
     * Occurrences of this run's subjects failing to read the same way twice.
     *
     * Travels with the run rather than in a call of its own, so that a service
     * commits both or neither: an instability whose run never landed has no
     * denominator, and it is exactly the row a later query divides by.
     *
     * Optional because most runs have none, and because a caller that does not
     * look for instability at all must not have to say so in every write.
     */
    instabilities?: readonly Instability[],
  ): Promise<void>;

  /**
   * Record that somebody accepted what a run proposed, for these subjects.
   *
   * A separate call from {@link HistoryStore.record} because it happens at a
   * separate time, by a separate party, with separate evidence: a run proposes
   * and a reviewer decides. Every row a run writes is unapproved, so without this
   * the rule "drift sums only approved changes" sums nothing — see
   * {@link Approval}.
   */
  approve(approvals: readonly Approval[]): Promise<void>;

  /**
   * The rows currently recorded for a set of subjects — the latest per
   * `(subject, component, band, profile)`, and nothing older.
   *
   * **The one read a run asks about the present**, and the reason there is now a
   * caller at all. The write rule this whole design rests on — *a row is written
   * only when a hash moves* — needs the previous rows to compare against, and the
   * four questions below are all questions about the **past**, asked by a person
   * or an agent. The closest, {@link HistoryStore.lastChanged}, returns one row:
   * computing `previous` through it costs a request per component per band, which
   * for 300 subjects at ten components each is 9,000 round trips per run.
   *
   * So this is a bulk read, and the alternative — sending everything observed and
   * letting the service drop rows equal to the stored ones — was rejected because
   * it puts every component of every subject in the request body on every run,
   * which is the size `maxBodyBytes` exists to refuse (spec 0002, ADR-0031).
   *
   * **It never truncates, and takes no `limit`.** Every other read here caps and
   * reports what it left out, because a partial answer to a question about the
   * past is a lower bound its reader can be told about. A partial answer *here* is
   * different in kind: a missing previous row is indistinguishable from a hash
   * that never existed, so the run writes a change that did not happen — and that
   * row is then permanent, in an append-only store, inflating every rate computed
   * over it forever. A request too large to answer whole is refused loudly
   * instead; the client splits its subject list rather than accepting less.
   *
   * The answer is not bounded by the age of the project, which is what keeps it
   * inside this file's "nothing loads a whole history" rule: it is one row per
   * live scope in the subjects asked for, so it is bounded by the code under test.
   */
  current(subjects: readonly string[]): Promise<Answer<Current>>;

  /**
   * The most recent row for an area, or `null` when nothing was ever recorded for
   * it. `null` is an answer — "this store has been keeping a record and has never
   * seen this change" — and is not the same as {@link Unkept}.
   */
  lastChanged(subject: string, component: string, band?: Band): Promise<Answer<Observation | null>>;

  churn(component: string, window: Window): Promise<Answer<Churn>>;

  /**
   * How often a subject has read differently from itself, and whether it still
   * does. See {@link Flakiness}.
   */
  flakiness(subject: string, window: Window): Promise<Answer<Flakiness>>;

  valueJourney(token: string, window: Window): Promise<Answer<Journey>>;

  /**
   * TODO: give `lastChanged` and `reach` a caller. Both are implemented in every
   * backend and served by `packages/server/src/http.ts` and
   * `packages/tribunal/src/worker.ts`; the other four reads on this interface are
   * asked by `recordRun` in `packages/cli/src/commands/history.ts`, so the run
   * asks and the report carries. These two are questions about the suite rather
   * than about one run — when a component last moved, and where it has started
   * appearing — so they close when a surface that asks about the past on purpose
   * calls them: the review UI in `packages/tribunal/src/ui`.
   */
  reach(component: string, window: Window): Promise<Answer<Reach>>;
}
