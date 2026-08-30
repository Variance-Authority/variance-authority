/**
 * One render, whole: the picture on the left and everything that is not the
 * picture on the right.
 *
 * Apart from the build page because it is the deepest address on the surface and
 * the only one where the raster is the subject rather than the evidence. What
 * reaches it is a link from a change — the reviewer has already been told what
 * moved and why, and came here to look.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Decision, SubjectView } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { Findings } from './findings.js';
import { SubjectHistory } from './history.js';
import { messageOf } from './shell.js';
import { when } from './text.js';
import { Viewer } from './viewer.js';

/**
 * One subject: the render on the left, everything that is not the render on the
 * right.
 *
 * The split is not decoration. A reviewer decides from the defect list, the
 * record and the sentence explaining the verdict, and on a full-page capture all
 * three sat nine thousand pixels below the thing they are about. They are a
 * column now, and it does not move when the picture does.
 */
export function SubjectPanel({
  client,
  reviewer,
  build,
  subject,
  sourced,
  onDecided,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly build: string;
  readonly subject: SubjectView;
  /** Whether the run resolved any source file — see {@link RegionTable}. */
  readonly sourced?: boolean | undefined;
  readonly onDecided: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const page = useRef<HTMLDivElement>(null);

  // This panel used to be remounted per subject, which threw away the comparison
  // mode and the magnification along with everything else — sixty re-clicks to
  // read twenty subjects the same way. Those are the reviewer's working method
  // and they stay; a failure from the last subject and its scroll position are
  // not, and are what the remount was really for.
  useEffect(() => {
    setBusy(false);
    setFailed(null);
    page.current?.scrollTo({ top: 0 });
  }, [subject.subject]);

  const decide = async (decision: Decision): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      await client.decide(build, subject.subject, decision, reviewer);
      onDecided();
    } catch (error) {
      // Kept on the page rather than swallowed. A decision that silently did not
      // land is a reviewer who believes a baseline was promoted and a next run
      // that reports the same change again.
      setFailed(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="va-subject">
      <div className="va-stage va-scroll" ref={page}>
        <div className="va-page">
          <header className="va-subject-head">
            <h3>{subject.subject}</h3>
            <span className={`va-verdict va-${subject.verdict}`}>{subject.verdict}</span>
          </header>
          <p className="va-because">{subject.because}</p>

          <Viewer client={client} build={build} subject={subject} sourced={sourced} />
        </div>
      </div>

      <aside className="va-aside va-scroll">
        <section className="va-card">
          <h2>Decision</h2>
          {subject.decision === null ? null : (
            <p className="va-decision">
              {subject.decision.decision} by {subject.decision.by} · {when(subject.decision.at)}
              {subject.decision.note === undefined ? null : <> — {subject.decision.note}</>}
            </p>
          )}
          {failed === null ? null : <p className="va-failure">{failed}</p>}
          <p className="va-actions">
            <button
              type="button"
              className="va-approve"
              disabled={busy || !subject.approvable}
              onClick={() => void decide('approved')}
              title={
                subject.approvable
                  ? 'Make this build’s candidate the baseline'
                  : 'This run kept no candidate image, so there is nothing to promote. Approving would mean rendering one now, which is recording rather than promoting.'
              }
            >
              Approve
            </button>
            <button type="button" disabled={busy} onClick={() => void decide('rejected')}>
              Reject
            </button>
          </p>
          {subject.approvable ? null : (
            <p className="va-note" style={{ marginTop: '0.5rem' }}>
              No candidate was uploaded for this subject, so it cannot be approved here.
            </p>
          )}
        </section>

        <section className="va-card">
          <h2>Findings</h2>
          <Findings subject={subject} />
        </section>

        <section className="va-card">
          <h2>The record</h2>
          <SubjectHistory client={client} subject={subject} />
        </section>
      </aside>
    </section>
  );
}
