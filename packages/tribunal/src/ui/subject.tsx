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
import type { Ruler } from './distance.js';
import { Findings } from './findings.js';
import { glanceOf, type Blamed, type Glance } from './glance.js';
import { SubjectHistory } from './history.js';
import { MovedHere } from './moved.js';
import { messageOf } from './shell.js';
import { count, number, when } from './text.js';
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
  anchor,
  far,
  sourced,
  onDecided,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly build: string;
  readonly subject: SubjectView;
  /** The change this render is filed under, which distances are measured from. */
  readonly anchor?: string | undefined;
  /** How far each component here is from that change, when a diff was read. */
  readonly far?: Ruler | undefined;
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
          <Glanced subject={subject} />
          <p className="va-said">{subject.because}</p>

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
          <h2>What moved</h2>
          <MovedHere subject={subject} anchor={anchor} far={far} />
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

/**
 * The three measurements, before the sentence that used to carry them.
 *
 * A reviewer arriving here has one question — *what changed* — and the line that
 * answered it was prose: pixels, then a name, then a resize, then a caveat, in
 * one two-hundred-character sentence with the interesting part in the middle.
 * Read once. Skipped on the second subject, because the shape of it is the same
 * every time and a reader who has parsed it twice stops looking for where the
 * numbers moved.
 *
 * Three cells instead, each a number over its unit. Nothing to read in order,
 * because these are three answers to one question and a reviewer takes them at a
 * glance or not at all. The sentence stays underneath and stays quiet: it is the
 * run's own words, it carries the collection's complaints, and demoting it is
 * not the same as dropping it.
 *
 * `null` for a subject with nothing to measure. An unchanged render would get
 * three cells reading `—`, which is a page insisting it has something to say.
 */
function Glanced({ subject }: { readonly subject: SubjectView }): ReactElement | null {
  const at = glanceOf(subject);
  if (at.pixels === 0 && at.grew === undefined && at.blamed.length === 0) return null;

  return (
    <div className="va-glance">
      <Cause at={at} />
      {at.grew === undefined ? null : (
        <p className="va-glance-cell">
          <b>
            {at.grew.by > 0 ? '+' : ''}
            {number(at.grew.by)} px
          </b>
          <span>{at.grew.axis}</span>
          <small>
            {number(at.grew.from.width)}×{number(at.grew.from.height)} →{' '}
            {number(at.grew.to.width)}×{number(at.grew.to.height)}
          </small>
        </p>
      )}
      {at.pixels === 0 ? null : (
        <p className="va-glance-cell">
          <b>{number(at.pixels)} px</b>
          <span>{count(at.regions, 'region')}</span>
          {at.landedIn === undefined ? null : <small>drawn over {at.landedIn}</small>}
        </p>
      )}
    </div>
  );
}

/**
 * Who moved, per the hashes — which is not who the regions are named after.
 *
 * The distinction this cell exists for. A region is named from where its box
 * landed, so an edit that pushed its container reports under the container;
 * these entries compared digests and never saw a pixel. On the subject that
 * prompted this, the prose said `Card` and the hashes say `Button`, and only one
 * of those is a file anybody edited.
 *
 * A cause no region names is marked rather than left implicit. That is the two
 * tiers disagreeing about where a change is, and it is the state a reviewer
 * should distrust the picture in.
 */
function Cause({ at }: { readonly at: Glance }): ReactElement | null {
  if (!at.measured) return null;
  if (at.blamed.length === 0) {
    return (
      <p className="va-glance-cell va-glance-none">
        <b>nothing owned it</b>
        <span>every digest matched</span>
      </p>
    );
  }

  const shown = at.blamed.slice(0, 2);

  return (
    <p className="va-glance-cell va-glance-cause">
      <b>
        {shown.map((each) => each.component).join(', ')}
        {at.blamed.length > shown.length ? ` +${number(at.blamed.length - shown.length)}` : ''}
      </b>
      <span>{sense(shown)}</span>
      {shown[0]?.grew === undefined || shown.length > 1 ? null : (
        <small>{sized(shown[0].grew)}</small>
      )}
      {shown.every((each) => each.drawn) ? null : (
        <small className="va-glance-off" title="the hashes name it; no region does">
          no region carries it
        </small>
      )}
    </p>
  );
}

/**
 * A box delta, on the axes that moved.
 *
 * Both axes get the cross form and one gets a word, because *+36 x +8 px* with a
 * zero in it is a reader working out which number is the one that changed.
 */
function sized({ width, height }: { readonly width: number; readonly height: number }): string {
  const w = `${width > 0 ? '+' : ''}${number(width)}`;
  const h = `${height > 0 ? '+' : ''}${number(height)}`;
  if (width === 0) return `${h} px tall`;
  if (height === 0) return `${w} px wide`;
  return `${w} × ${h} px`;
}

/**
 * The bands, once each, in the order they were found.
 *
 * A component present on one side only says that instead: `added` and `removed`
 * are not bands and a list that folded them in would report a control that did
 * not exist before as having changed its geometry.
 */
function sense(blamed: readonly Blamed[]): string {
  const presence = [...new Set(blamed.map((each) => each.presence).filter(Boolean))];
  if (presence.length > 0) return presence.join(', ');
  return [...new Set(blamed.flatMap((each) => each.bands))].join(' · ');
}
