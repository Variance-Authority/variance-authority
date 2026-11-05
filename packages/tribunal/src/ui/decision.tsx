/**
 * The verdict on one render, at the top right of its page.
 *
 * *Approve* is the one filled control on the page, and it holds this place from
 * render to render. A verdict is taken on something seen, so with no image kept
 * neither button is live and both point at the viewer's note saying why. An
 * approval has already moved the baseline and a rejection would not move it back,
 * so what it leaves is the record of it; second thoughts are a concern.
 */

import type { ReactElement } from 'react';
import type { Decision, SubjectView } from '../review-types.js';
import { needsReview } from './settled.js';
import { when } from './text.js';
import { NO_CANDIDATE } from './viewer.js';

export function DecisionControls({
  subject,
  busy,
  onDecide,
}: {
  readonly subject: SubjectView;
  readonly busy: boolean;
  readonly onDecide: (decision: Decision) => void;
}): ReactElement | null {
  const decided = subject.decision;

  if (decided !== null) {
    return (
      <div className="va-subject-decision">
        <p className={decided.decision === 'rejected' ? 'va-decision va-decision-rejected' : 'va-decision'}>
          {decided.decision} by {decided.by} · {when(decided.at)}
          {decided.note === undefined ? null : <> — {decided.note}</>}
        </p>
        {decided.decision === 'rejected' && subject.approvable ? (
          <button type="button" disabled={busy} onClick={() => onDecide('approved')}>
            Approve instead
          </button>
        ) : null}
      </div>
    );
  }

  // An unchanged render already is its baseline: there is nothing to accept.
  if (!needsReview(subject.verdict)) return null;

  const why = subject.has.after ? undefined : NO_CANDIDATE;

  return (
    <div className="va-subject-decision">
      {subject.has.after && !subject.approvable ? (
        <p className="va-note">The run kept no document for this image, so it cannot become a baseline.</p>
      ) : null}
      <button
        type="button"
        className="va-approve"
        disabled={busy || !subject.approvable}
        aria-describedby={why}
        title="Make this build’s image the baseline"
        onClick={() => onDecide('approved')}
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy || !subject.has.after}
        aria-describedby={why}
        onClick={() => onDecide('rejected')}
      >
        Reject
      </button>
    </div>
  );
}
