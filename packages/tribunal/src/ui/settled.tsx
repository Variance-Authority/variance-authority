/**
 * The subjects that came back green, and which kind of green each one is.
 *
 * The rail carries what needs a decision, and a subject that was absorbed by an
 * ignore does not — the rule already made the decision, on a day somebody wrote
 * it into the config. But green by measurement and green by declaration are not
 * the same fact, and the second is the one that goes wrong silently: a rule that
 * has grown over a real regression reports `ignored` every run and reads exactly
 * like a subject nothing happened to.
 *
 * So they are kept, folded. Behind a `<details>` because on a run of three
 * hundred stories this is three hundred lines of nothing, and open in one click
 * because the moment a reviewer wants it is the moment they are asking *what did
 * this build not tell me*.
 *
 * The sentence under each name is the observer's own, unedited. This surface did
 * not measure anything and has nothing to add — and where the record does not say
 * which rule absorbed a subject, the note says that rather than leaving a reader
 * to conclude the difference was small.
 *
 * Which rule that was is read by `greenBecause` in the report package, the same
 * call the HTML report makes over the same block. The report and this page are
 * two renderings of one run and are read by one person, often minutes apart; a
 * second derivation here is a second answer waiting to happen.
 */

import type { ReactElement } from 'react';
import { greenBecause, type Green, type IgnoreLedger } from '@variance-authority/report';
import type { SubjectView } from '../review-types.js';
import { count, number } from './text.js';

/** The two green verdicts, in the order they are worth reading. */
const GREEN: readonly SubjectView['verdict'][] = ['ignored', 'unchanged'];

/**
 * Whether a subject is one the rail carries.
 *
 * The report's own predicate, word for word, and it is shared by copy rather than
 * import because the two live in different packages. Both green verdicts are out:
 * `unchanged` because nothing moved, and `ignored` because a declaration already
 * decided it. A rail that carried `ignored` would put a subject nobody can act on
 * in the queue, under a header that says how many are awaiting review.
 */
export function needsReview(verdict: SubjectView['verdict']): boolean {
  return verdict !== 'unchanged' && verdict !== 'ignored';
}

export function Settled({
  subjects,
  ignores,
}: {
  readonly subjects: readonly SubjectView[];
  readonly ignores: IgnoreLedger | null;
}): ReactElement | null {
  const green = subjects.filter((subject) => !needsReview(subject.verdict));
  if (green.length === 0) return null;

  const absorbed = green.filter((subject) => subject.verdict === 'ignored');

  return (
    <details className="va-settled">
      <summary>
        {count(green.length - absorbed.length, 'subject')} unchanged
        {absorbed.length === 0
          ? ''
          : ` · ${count(absorbed.length, 'subject')} green because a rule absorbed the difference`}
      </summary>

      {GREEN.map((verdict) => {
        const rows = green.filter((subject) => subject.verdict === verdict);
        if (rows.length === 0) return null;
        return (
          <ul key={verdict} className="va-settled-list">
            {rows.map((subject) => (
              <li key={subject.subject}>
                <span className={`va-dot va-${subject.verdict}`} />
                <strong>{subject.subject}</strong>
                <span className="va-note">{subject.because}</span>
                <Because subject={subject} />
              </li>
            ))}
          </ul>
        );
      })}

      {absorbed.length > 0 && ignores === null ? (
        <p className="va-note">
          This build carried no ignore ledger, so which rule absorbed each of these — and whether
          it absorbed anything anywhere else — is not recorded here.
        </p>
      ) : null}
    </details>
  );
}

/**
 * Which declaration decided this subject, when the record says.
 *
 * `unsaid` is rendered rather than skipped. A green-by-declaration row with no
 * rule beside it reads as a subject whose difference was too small to name, and
 * the difference between *nobody wrote it down* and *nothing happened* is the
 * whole reason `ignored` is a word of its own.
 *
 * `masked` is the row worth the most and belongs to `unchanged`: a rule stood
 * over this subject and caught nothing. One run of that is ordinary; it is the
 * count in the ledger below, run after run, that turns it into a finding.
 */
function Because({ subject }: { readonly subject: SubjectView }): ReactElement | null {
  const green: Green = greenBecause(subject);

  switch (green.kind) {
    case 'measured':
      return null;
    case 'masked':
      return (
        <span className="va-note">
          masked in {count(green.boxes, 'place')}, and nothing differed under them
        </span>
      );
    case 'relaxed':
      return (
        <span className="va-mark va-ignored">
          asserted on {green.level} · <code>{green.rule}</code> absorbed {green.bands.join(', ')}
        </span>
      );
    case 'unsaid':
      return (
        <span className="va-note">
          this build does not record which rule absorbed it
        </span>
      );
    default:
      return (
        <span className="va-mark va-ignored">
          absorbed by <code>{green.rules.join(', ')}</code> · {number(green.pixels)} px
        </span>
      );
  }
}
