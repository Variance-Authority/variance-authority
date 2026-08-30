/**
 * What became of each subject between two runs — the fold, with nothing drawn.
 *
 * A build page compares a candidate to a baseline and stops. So a difference that
 * arrived on Tuesday, went undecided, and arrived again on Wednesday is drawn on
 * Wednesday exactly as it was on Tuesday: eighteen thumbnails, no memory, and a
 * reviewer re-reading a docket they already read. The second reading costs the
 * same as the first, which is why the fourth one does not happen.
 *
 * The shape digest is what makes the answer exact rather than approximate. Two
 * runs whose leading regions carry the same fingerprint are carrying *the same
 * difference*, not a similar one, and that licenses the only sentence worth
 * printing anywhere off this: **you have seen this, and it has not moved since.**
 *
 * ## Absent is not equal
 *
 * A run that recorded no shape for its leading region said nothing, and two runs
 * that both said nothing did not agree. Those get their own state, because
 * folding them into *the same difference again* would be a confident claim about
 * a pair nothing measured — on the one screen where the claim tells somebody they
 * can skip looking.
 *
 * Separate from the panels that read it because there are now three of them: the
 * build reads the whole crossing, a change reads the rows under one component,
 * and a subject reads its own single row. One fold, and none of them may reach a
 * different answer than the others about the same pair of runs.
 */

import type { BuildDetail, SubjectView } from '../review-types.js';
import { shapeOf } from './lead.js';

/** What became of one subject between the two runs. */
export type Shift =
  | 'differently'
  | 'unsaid'
  | 'first'
  | 'new'
  | 'again'
  | 'settled'
  | 'declared'
  | 'absorbed'
  | 'unmasked'
  | 'unplaced'
  | 'uncompared'
  | 'dropped'
  | 'held';

export interface Shifted {
  readonly subject: string;
  readonly shift: Shift;
  /** This run's reading. Absent only when the subject was dropped. */
  readonly now?: SubjectView;
  /** The earlier run's reading, including whatever was decided about it. */
  readonly earlier?: SubjectView;
}

export interface Divergence {
  readonly shifts: readonly Shifted[];
  /** Subjects both runs compared and neither found a difference in. */
  readonly held: number;
}

/**
 * The two runs crossed, one row per subject either of them named.
 *
 * Union rather than intersection: a subject the earlier run had and this one does
 * not is a suite that shrank, and an intersection would report that as nothing
 * having happened.
 */
export function divergeFrom(now: BuildDetail, prior: BuildDetail): Divergence {
  const before = new Map(prior.subjects.map((subject) => [subject.subject, subject]));
  const shifts: Shifted[] = [];
  let held = 0;

  for (const subject of now.subjects) {
    const earlier = before.get(subject.subject);
    before.delete(subject.subject);
    const shift = shiftOf(subject, earlier);
    if (shift === 'held') held += 1;
    else shifts.push({ subject: subject.subject, shift, now: subject, ...(earlier === undefined ? {} : { earlier }) });
  }

  for (const earlier of before.values()) {
    shifts.push({ subject: earlier.subject, shift: 'dropped', earlier });
  }

  return { shifts, held };
}

/**
 * Whether a verdict describes a pair this run actually put side by side.
 *
 * `ignored` belongs here and reads as though it does not. A declaration decided
 * it, but the comparison it decided happened: there was a baseline, there were
 * differing pixels, and every one of them landed somewhere the operator wrote
 * down. Filing it with `incomparable` told a reviewer *no baseline was put beside
 * them here* about subjects that were compared — an absence invented on top of a
 * measurement, which is the one thing this panel exists not to do.
 */
function compared(subject: SubjectView): boolean {
  return (
    subject.verdict === 'changed' ||
    subject.verdict === 'unchanged' ||
    subject.verdict === 'ignored'
  );
}

function shiftOf(now: SubjectView, earlier: SubjectView | undefined): Shift {
  if (earlier === undefined) return 'new';
  if (!compared(now)) return 'uncompared';
  if (!compared(earlier)) return 'unplaced';

  // A declaration standing over both runs is bookkeeping; one that arrived
  // between them is a rule that has just taken a subject out of review, and the
  // subject it took is named. That is the moment a mask starts covering
  // something, and it is visible exactly once — here.
  if (now.verdict === 'ignored') return earlier.verdict === 'ignored' ? 'declared' : 'absorbed';

  // The other direction. A subject a rule absorbed there and nothing absorbs
  // here either stopped differing — which is `settled`, and true whether or not
  // a rule was watching — or is being reported, which is the rule failing to
  // cover what it was written for.
  if (earlier.verdict === 'ignored') return now.verdict === 'unchanged' ? 'settled' : 'unmasked';

  if (now.verdict === 'unchanged') return earlier.verdict === 'unchanged' ? 'held' : 'settled';
  if (earlier.verdict === 'unchanged') return 'first';

  const here = shapeOf(now);
  const there = shapeOf(earlier);
  if (here === undefined || there === undefined) return 'unsaid';
  return here === there ? 'again' : 'differently';
}
