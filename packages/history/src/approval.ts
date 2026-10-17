/**
 * That somebody accepted what a run proposed for one subject.
 *
 * The row that was missing, and the reason every drift total in this package
 * would have been zero without it. `Observation.accepted` is a fact recorded *at
 * write time*, and a run cannot know it: acceptance happens afterwards, in
 * `variance accept` or in a review surface, by a person who has looked. So every
 * row a run writes is `accepted: false` — correctly — and drift, which sums only
 * approved changes, sums nothing.
 *
 * **It is a second row rather than a flag that gets flipped.** The store is
 * append-only, and that is not fastidiousness: two branches observing different
 * hashes for one key are two rows, and the moment anything may overwrite a row
 * the store acquires the merge problem it exists to escape. An update would also
 * silently rewrite a number somebody already read.
 *
 * **It is per `(subject, run)` rather than per hash**, because that is what a
 * review actually decides. A reviewer looks at a subject in a build and says yes;
 * they do not accept a `structure` digest. Keying it any finer would invent a
 * decision nobody made, and keying it coarser — per run — would make one approved
 * subject approve the forty nobody looked at.
 */

export interface Approval {
  readonly project: string;
  readonly subject: string;
  /** The run whose observations of this subject are approved. */
  readonly run: string;
  readonly at: string;

  /**
   * Who approved it, when the surface that recorded it knows.
   *
   * Optional, and absent is not "nobody": `variance accept` runs on somebody's
   * machine or in CI and has no identity to offer that would mean anything.
   * A review service that does know one records it, which is where the question
   * "who approved this" becomes answerable at all — and until identity exists at
   * all ([spec 0014](https://github.com/Variance-Authority/variance-authority/blob/main/docs/specs/0014-hosted-who-the-caller-is-and-what-the-bill-counts.md)),
   * an absent value is the honest one.
   */
  readonly by?: string;
}

/** The key an observation and an approval meet on. */
export function approvalKey(subject: string, run: string): string {
  return `${run}\u0000${subject}`;
}
