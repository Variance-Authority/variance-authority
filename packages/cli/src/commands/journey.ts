/**
 * Which subjects the last run *entered* the changed code from — the second
 * ground, and the only one that is about time rather than shape.
 *
 * [`affected.ts`](./affected.ts) narrows by structure: the diff names files, the
 * files declare or reach components, the baselines record which components a
 * subject is made of. Every step of that is true of the source at rest. It
 * cannot tell an edit inside a `useEffect` — which every story runs on mount —
 * from an edit inside an `onClick` that no story ever fires, because both are
 * lines in the same file declaring the same component, and the structural ground
 * answers *this subject contains `CartCard`* to both.
 *
 * The execution journal answers the other question. Probes spliced into the
 * arrival regions of the build the run drove record which regions each subject
 * crossed while it was being painted, so `CartCard.tsx:22-25` is *entered by all
 * three cart stories* and `CartCard.tsx:51` is *entered by the one that clicks*.
 * A diff falling entirely in the second is a diff two of those three subjects
 * can be ruled out of — and no reading of the file could have ruled them out.
 *
 * ## It only ever removes, and only from what the first ground kept
 *
 * Both grounds narrow, neither widens, and a subject either survives both or is
 * not observed. Running this over the whole plan instead would let a journal
 * recorded before a subject existed rule out a subject the diff plainly reaches.
 *
 * ## Absent is unknown, and unknown is observed
 *
 * The snapshot speaks for the tests it recorded whole and for no others, so:
 *
 * - a subject the snapshot never recorded is observed — the last run did not
 *   paint it, or painted it before the probes were built in;
 * - a subject whose recorded observation was partial is observed — an upper
 *   bound cannot justify an exclusion;
 * - a snapshot with nothing whole in it narrows nothing, and says so.
 *
 * That last one is the failure this shape exists to refuse. `entered` coming
 * back empty has two readings — *the diff reached nobody* and *the journal
 * recorded nobody* — and they are opposite facts about the same empty list. Held
 * apart here, because a run that confused them would skip its entire suite and
 * report success.
 *
 * A changed file the journal, its declarations and the file graph hold nothing
 * about is not an input. The reader has already answered it by its measured
 * importers where there were any, and a module the build loaded and could not
 * instrument is declared a precondition of every subject that loaded it, so what
 * is left entered nobody by any route the record can see. The caller names it
 * beside the answer; it does not change the answer.
 */

import { many } from './reach.js';

export interface JourneyInput {
  /** Subjects the structural ground would observe, by id. */
  readonly planned: readonly string[];
  /** Recorded observations that were whole, so absence from `entered` is evidence. */
  readonly whole: readonly string[];
  /** Recorded observations that crossed a region this diff changed. */
  readonly entered: readonly string[];
}

export interface Journeyed {
  /** Subjects the journal proves this diff never reached, with the sentence that says so. */
  readonly skipped: readonly { readonly subject: string; readonly because: string }[];

  /**
   * Why the journal ruled nothing out, when it did not.
   *
   * Present is a statement about the *journal*, not about the diff: nothing in it
   * was whole, or nothing in it was about the subjects this run planned. Both
   * produce the same empty `skipped` as a diff that reached everyone, and a run
   * that printed neither would leave an operator to infer which from a count.
   */
  readonly whole?: string;

  /** One sentence for the report, whichever way it went. */
  readonly because: string;
}

/**
 * Decide what the recorded journeys rule out.
 *
 * Pure, and takes the journal as two lists: the read of a binary snapshot from a
 * user cache belongs to the caller, which is what makes every rule above
 * assertable with no cache, no build and no browser.
 */
export function unenteredSubjects(input: JourneyInput): Journeyed {
  const { planned } = input;
  const whole = new Set(input.whole);
  const entered = new Set(input.entered);

  const known = planned.filter((subject) => whole.has(subject));
  if (known.length === 0) {
    return {
      skipped: [],
      whole:
        'the recorded execution journal holds no whole observation of any subject in this run, ' +
        'so it cannot say which of them covered the changed code',
      because: 'the execution journal said nothing about this run’s subjects',
    };
  }

  const skipped = known
    .filter((subject) => !entered.has(subject))
    .map((subject) => ({
      subject,
      because:
        'the last run recorded every region it covered while it was painted, and this diff ' +
        'changed none of them',
    }));

  return {
    skipped,
    because:
      `${many(skipped.length, 'subject')} covered none of the changed code when last painted, ` +
      `out of ${many(known.length, 'subject')} the journal recorded whole` +
      (known.length === planned.length
        ? ''
        : ` (${planned.length - known.length} of them it has no whole record of, ` +
          'and those were observed)'),
  };
}
