/**
 * One line under a subject's decision: an earlier build kept this same image.
 *
 * The decision made there leads, because it is what a reviewer acts on here. A
 * rejected image that is back is a known defect, drawn as a failure. An approved
 * image is promoted to the baseline, so when this render differs from today's
 * baseline the baseline has changed since, and the subject renders one image and
 * then another in turn.
 */

import type { ReactElement, ReactNode } from 'react';
import type { RepeatedIn, SubjectView } from '../review-types.js';
import type { Route } from './route.js';
import { Go } from './shell.js';
import { count, when } from './text.js';

export function Repeated({
  subject,
  go,
}: {
  readonly subject: SubjectView;
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
    <p className={classOf(lead, subject)}>
      {sentence(lead, subject, build)}
      {others}
    </p>
  );
}

function classOf(lead: RepeatedIn, subject: SubjectView): string {
  if (lead.decision?.decision === 'rejected') return 'va-failure';
  if (lead.decision?.decision === 'approved' && subject.verdict === 'changed') {
    return 'va-note va-warned';
  }
  return 'va-note';
}

function sentence(lead: RepeatedIn, subject: SubjectView, build: ReactNode): ReactNode {
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
  if (subject.verdict === 'changed') {
    return (
      <>
        Build {build} approved this image {who}, and the baseline has changed since. Either the
        render is unstable, or a change was reverted.
      </>
    );
  }
  return <>Build {build} approved this image {who}.</>;
}
