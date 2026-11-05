// compass: variance-authority.review
/**
 * The decision on one render, at the top right of its page.
 *
 * A decision is taken on something seen, so with no image kept neither button is
 * live and the reason stands beside them. {@link decidableOf} is the one reading
 * of what each button may do: the rows on a change page take it from here, so the
 * two pages cannot disagree about a render, and the batch settles only what it
 * can approve.
 */

import { useId, type ReactElement } from 'react';
import type { Decision, SubjectView } from '../review-types.js';
import { when } from './text.js';

/** What a render lets a reviewer do, and the sentence for what it does not. */
export interface Decidable {
  readonly approve: boolean;
  readonly reject: boolean;
  readonly why: string | undefined;
}

export function decidableOf(subject: Pick<SubjectView, 'has' | 'approvable'>): Decidable {
  if (!subject.has.after) {
    return {
      approve: false,
      reject: false,
      why: 'The run kept no candidate image, so there is nothing to approve or reject.',
    };
  }
  if (!subject.approvable) {
    return {
      approve: false,
      reject: true,
      why: 'The run kept no document for this image, so it cannot become a baseline.',
    };
  }
  return { approve: true, reject: true, why: undefined };
}

export function DecisionControls({
  subject,
  busy,
  onDecide,
}: {
  readonly subject: SubjectView;
  readonly busy: boolean;
  readonly onDecide: (decision: Decision) => void;
}): ReactElement {
  const decidable = decidableOf(subject);
  const decided = subject.decision;
  const id = useId();
  const described = decidable.why === undefined ? undefined : id;

  return (
    <div className="va-subject-decision">
      {decided === null ? null : (
        <p className="va-decision">
          {decided.decision} by {decided.by} · {when(decided.at)}
          {decided.note === undefined ? null : <> — {decided.note}</>}
        </p>
      )}
      {decidable.why === undefined ? null : (
        <p className="va-note" id={id}>
          {decidable.why}
        </p>
      )}
      <button
        type="button"
        className="va-approve"
        disabled={busy || !decidable.approve}
        aria-describedby={described}
        title={decidable.approve ? 'Make this build’s candidate the baseline' : undefined}
        onClick={() => onDecide('approved')}
      >
        Approve
      </button>
      <button
        type="button"
        className="va-reject"
        disabled={busy || !decidable.reject}
        aria-describedby={described}
        onClick={() => onDecide('rejected')}
      >
        Reject
      </button>
    </div>
  );
}
