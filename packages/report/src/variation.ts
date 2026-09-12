/**
 * One subject read against the subject it declares itself a variation of.
 *
 * A flattened `Variation` from `@variance-authority/core`, for the reason
 * {@link ChurnRecord} is a copy rather than an import: a report reader must not
 * have to install the comparison engine to open a file. The deltas themselves
 * are not here — a report is read by something that wants a sentence, and the
 * bands, the components and the digest are what a sentence is made of.
 *
 * **This is never a verdict.** A variation is a difference somebody declared on
 * purpose; reporting it as a regression would be reporting a subject for
 * existing. Nothing here reaches `exitFor`, `accept` or the baseline store.
 */
export interface VariationRecord {
  readonly subject: string;

  /**
   * The parent's subject id, once it resolved to a subject in this run.
   *
   * Absent when the declaration named something the run does not have — which is
   * a state with its own sentence in `because`, and not the same claim as a
   * variation that was compared and found identical.
   */
  readonly parent?: string;

  /** `true` when both sides render to one hash: the variation changes nothing. */
  readonly identical?: boolean;

  /** Bands the difference falls in, in band order. Present with the comparison. */
  readonly bands?: readonly string[];

  /** Bands neither side's profile could decide. Absent is not "none". */
  readonly unobserved?: readonly string[];

  /**
   * Bands that were decided, on less than the evidence the band is made of.
   *
   * Separate from `unobserved` because the two are opposite failures of one word.
   * An unobserved band has no answer and says so; a narrowed band answers in the
   * same word a fully observed one uses, over a smaller question — JSDOM compares
   * `padding: 1rem` as `1rem` and never resolves it, so a root font-size that
   * moved underneath is outside the comparison that just returned "alike".
   * `because` carries what each one covered; this is the field to count.
   */
  readonly narrowed?: readonly string[];

  /** Components the difference was attributed to, causes first. */
  readonly components?: readonly string[];

  /**
   * The identity of the difference itself, `variation/v1` over its deltas.
   *
   * Stable across a change that moved both subjects the same way, which is the
   * whole reason a linked pair is worth more than two independent baselines: it
   * distinguishes *this flag now does something else* from *everything moved*.
   */
  readonly digest?: string;

  /**
   * How the pair came to be a pair.
   *
   * `declared` is a tag somebody wrote. `named` is an inference from the ids: a
   * subject whose name extends another subject's name is that subject plus an
   * axis, which is how a suite that already encodes its variants in its names
   * gets this for free — and is correct exactly as often as the naming
   * convention is kept.
   *
   * On the record rather than derived from the presence of a tag, because the
   * report is read by things that never saw the plan, and *a person said so* and
   * *a name implied it* carry different weight in every sentence built from
   * this.
   */
  readonly how?: 'declared' | 'named';

  /** One sentence, ready to print, saying what this variation is or why it is not. */
  readonly because: string;
}
