import type { Band, ProfileId } from '@variance-authority/core';

/**
 * That a subject did not read the same way twice, and when.
 *
 * The longitudinal half of flake detection. A run reads a subject twice and
 * reports disagreement as `unstable` (ADR-0030), which is a **lower bound by
 * construction**: a subject that reads differently one time in fifty passes that
 * check forty-nine runs out of fifty. Two readings answer *did this one run
 * disagree with itself*; only a record answers *how often*, and *whether the fix
 * that went in last week worked*.
 *
 * Occurrences are rare by definition, so unlike observations these need no
 * write-only-on-movement rule: a flake that fired is a fact worth one row every
 * time it fires, and a subject that fired in eleven of the last twenty runs is a
 * different object from one that fired once in March.
 *
 * **Never pixels, and never a count of them**, for the reason `Observation` gives
 * — a pixel count measures displacement rather than magnitude and is machine
 * bound. What is kept is what a fix can be aimed at: which component read
 * differently, and in which frequency band.
 */

/**
 * `core`'s band, not this package's.
 *
 * Re-exported under a distinct name because `history` already has a `Band`, and
 * the two classify different things: {@link Band} here names *what part of a
 * component was hashed* (`structure` / `style` / `geometry`), while a frequency
 * band names *how often that kind of thing changes*, which is what decides how
 * loudly it is reported. An instability is reported in frequency bands, because
 * that is what `again` compares and what a sensitivity level is declared in —
 * `content` is data, `geometry` is layout that has not settled, `token` is a
 * style still being applied, and those are three different days of work.
 */
export type FrequencyBand = Band;

export interface Instability {
  readonly project: string;
  readonly subject: string;

  /**
   * The component that read differently, when the two readings could name one.
   *
   * Absent is a real state and not a blank: a collector that supplies documents
   * without snapshots proves the instability and gives nobody the means to name
   * it. Storing an empty string would read as *the disagreement belongs to no
   * component*, which is a claim about the page rather than about the collector.
   */
  readonly component?: string;

  /** The frequency band that moved, when one was resolved. See {@link FrequencyBand}. */
  readonly band?: FrequencyBand;

  readonly profile: ProfileId;
  readonly commit: string;
  readonly run: string;
  readonly at: string;

  /**
   * The sensitivity rule that absorbed this, when the subject declared one.
   *
   * Recorded rather than dropped. An absorbed instability is *working as
   * declared* — a route that asserts on layout is not lying when its clock ticks
   * — so it never gates and is never counted as a finding. But a declaration
   * nobody re-reads is how a suite quietly stops watching something, and a rule
   * absorbing an instability in every run for six months is worth being able to
   * ask about. Counted separately, in the same way collateral is.
   */
  readonly absorbedBy?: string;
}

