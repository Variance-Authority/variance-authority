/**
 * One line in a subject's Decision card: an earlier build kept this same image.
 *
 * The decision made there leads, because it is what a reviewer acts on here. A
 * rejected image that is back is a known defect. An approved image is promoted to
 * the baseline, so one approved before this build ran, on a render that still
 * differs from its baseline, is drawn as a warning.
 */

import type { ReactElement, ReactNode } from 'react';
import type { RepeatedIn, SubjectView } from '../review-types.js';
import type { Route } from './route.js';
import { Go } from './shell.js';
import { count, when } from './text.js';

export function Repeated({
  subject,
  ran,
  go,
}: {
  readonly subject: SubjectView;
  /** When the build on screen ran: an approval made later is not the baseline it was compared to. */
  readonly ran: string;
  /** Opens the earlier build. Absent, the build is named without a link. */
  readonly go?: ((route: Route) => void) | undefined;
}): ReactElement | null {
  const repeats = subject.repeats;
  const lead = repeats?.builds[0];
  if (repeats === undefined || lead === undefined) return null;

  const build: ReactNode =
    go === undefined ? (
      <code>{lead.build}</code>
    ) : (
      <Go to={{ page: 'subject', build: lead.build, subject: subject.subject }} go={go}>
        <code>{lead.build}</code>
      </Go>
    );
  const others =
    repeats.count > 1 ? ` ${count(repeats.count - 1, 'other earlier build')} kept it too.` : '';

  return (
    <p className={classOf(lead, subject, ran)}>
      {sentence(lead, subject, ran, build)}
      {others}
    </p>
  );
}

function classOf(lead: RepeatedIn, subject: SubjectView, ran: string): string {
  if (lead.decision?.decision === 'rejected') return 'va-note va-rejected';
  if (movedSince(lead, subject, ran)) return 'va-note va-warned';
  return 'va-note';
}

/**
 * Whether this build differs from its baseline though the image was approved
 * before it ran.
 *
 * The line states that and no cause: the render may alternate, a change may have
 * been reverted, or the baseline moved again. An approval made after this build
 * ran replaced the baseline this build was compared to, so its difference is
 * the one the approval answered, not a new one.
 */
function movedSince(lead: RepeatedIn, subject: SubjectView, ran: string): boolean {
  const decision = lead.decision;
  return (
    decision?.decision === 'approved' &&
    (subject.verdict === 'changed' || subject.verdict === 'incomparable') &&
    Date.parse(decision.at) < Date.parse(ran)
  );
}

function sentence(lead: RepeatedIn, subject: SubjectView, ran: string, build: ReactNode): ReactNode {
  const decision = lead.decision;
  if (decision === null) return <>Build {build} kept this image too, and has no decision.</>;

  const who = (
    <>
      ({decision.by} · {when(decision.at)}
      {decision.note === undefined ? null : <> — {decision.note}</>})
    </>
  );
  if (decision.decision === 'rejected') {
    return <>This is the image build {build} rejected {who}.</>;
  }
  if (movedSince(lead, subject, ran)) {
    return (
      <>
        Build {build} approved this image {who} before this build ran, and this build still
        differs from its baseline.
      </>
    );
  }
  return <>Build {build} approved this image {who}.</>;
}
