// compass: variance-authority.review
/**
 * The verdict on one render, at the top right of its page.
 *
 * A verdict is taken on something seen, so with no image kept neither button is
 * live and the reason stands beside them. {@link verdictOf} is the one reading of
 * what each button may do: the rows and the batch on a change page take it from
 * here, so the two pages cannot disagree about the same render.
 */

import { useId, type ReactElement } from 'react';
import type { Decision, SubjectView } from '../review-types.js';
import { when } from './text.js';

/** What a render lets a reviewer do, and the sentence for what it does not. */
export interface Verdict {
  readonly approve: boolean;
  readonly reject: boolean;
  readonly why: string | undefined;
}

export function verdictOf(subject: Pick<SubjectView, 'has' | 'approvable'>): Verdict {
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
  const verdict = verdictOf(subject);
  const decided = subject.decision;
  const id = useId();
  const described = verdict.why === undefined ? undefined : id;

  return (
    <div className="va-subject-decision">
      {decided === null ? null : (
        <p className="va-decision">
          {decided.decision} by {decided.by} · {when(decided.at)}
          {decided.note === undefined ? null : <> — {decided.note}</>}
        </p>
      )}
      {verdict.why === undefined ? null : (
        <p className="va-note" id={id}>
          {verdict.why}
        </p>
      )}
      <button
        type="button"
        className="va-approve"
        disabled={busy || !verdict.approve}
        aria-describedby={described}
        title={verdict.approve ? 'Make this build’s candidate the baseline' : undefined}
        onClick={() => onDecide('approved')}
      >
        Approve
      </button>
      <button
        type="button"
        className="va-reject"
        disabled={busy || !verdict.reject}
        aria-describedby={described}
        onClick={() => onDecide('rejected')}
      >
        Reject
      </button>
    </div>
  );
}
