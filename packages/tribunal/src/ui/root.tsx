/**
 * How a cause is drawn — as a heading over the changes it made, and on each of them.
 *
 * One module for both, because they are one claim printed twice and the two
 * places must not be able to disagree. The rail says *`ui/button.tsx` — three
 * renders*; the change page says *`Button` moved because `ui/button.tsx` is in
 * this commit*, and a reviewer who clicked from one to the other and found two
 * different files would stop believing either.
 *
 * ## The path is drawn, not summarised
 *
 * A basename is what a reviewer recognises and a path is what they can act on, so
 * both are printed and the directory is dimmed rather than dropped. Two files
 * called `button.tsx` in one build is an ordinary repository, and a heading that
 * showed only the leaf would put them under one name.
 *
 * ## Siblings are the reason this is on the change page at all
 *
 * `Because` already names the rung — the file, or the parent, one hop up. What it
 * cannot say is what *else* that file did, and that is the question a reviewer
 * has after deciding one of them: `ProductCard.tsx` moved `CardFooter` here and
 * `ProductCard` two rows down, and those are one edit with two consequences. The
 * links are the rest of the edit.
 */

import type { ReactElement } from 'react';
import type { BuildDetail } from '../review-types.js';
import type { Root } from './cause.js';
import { foreseenBy } from './foreseen.js';
import { originsOf, type Origin } from './grouping.js';
import { docketOf, type Group } from './order.js';
import type { Route } from './route.js';
import { Go } from './shell.js';
import { count, number } from './text.js';

/**
 * A band's heading: a path, a property, or a claim about a rung.
 *
 * The count beside a root is **renders**, not changes. *What did editing this
 * file do* is answered in renders — one change over eleven of them is the answer
 * a reviewer wants before they open it — while a band with no root counts changes,
 * because a finding the commit does not account for had no blast radius to have.
 */
export function RootHeading({
  group,
  detail,
  go,
}: {
  readonly group: Group;
  readonly detail: BuildDetail;
  readonly go: (route: Route) => void;
}): ReactElement {
  if (group.root === undefined) {
    return (
      <h3>
        {group.title} <span className="va-num">{number(group.changes.length)}</span>
      </h3>
    );
  }

  return (
    <>
      <h3 className={`va-root va-root-${group.root.kind}`} title={group.title}>
        <Path root={group.root} />
        <span className="va-num">{number(group.root.renders)}</span>
      </h3>
      {group.root.kind !== 'file' ? null : (
        <Prediction detail={detail} file={group.root.name} go={go} />
      )}
    </>
  );
}

/**
 * What editing this file was going to do, beside what it did.
 *
 * Drawn only for a file, because only a file makes the prediction: the reach walk
 * starts at a path the diff named. A property or an owner the commit never
 * touched has no set of subjects it was expected to arrive at, and a line under
 * one would be a number invented to fill the same slot.
 */
function Prediction({
  detail,
  file,
  go,
}: {
  readonly detail: BuildDetail;
  readonly file: string;
  readonly go: (route: Route) => void;
}): ReactElement | null {
  const seen = foreseenBy(detail, file);
  if (seen === null || seen.reached === 0) return null;

  const gaps = (
    [
      ['still', seen.still],
      ['excluded', seen.excluded],
      ['never compared', seen.uncompared],
    ] as const
  ).filter(([, subjects]) => subjects.length > 0);

  return (
    <p className="va-foreseen va-note">
      <span className="va-num">{number(seen.reached)}</span> reached
      {gaps.length === 0 ? <> · all moved</> : null}
      {gaps.map(([what, subjects]) => (
        <span key={what}>
          {' · '}
          <span className="va-num">{number(subjects.length)}</span> {what}:{' '}
          <Named subjects={subjects} build={detail.build} go={go} />
        </span>
      ))}
    </p>
  );
}

/** The subjects themselves, up to three, and a count of any it did not print. */
function Named({
  subjects,
  build,
  go,
}: {
  readonly subjects: readonly string[];
  readonly build: string;
  readonly go: (route: Route) => void;
}): ReactElement {
  const shown = subjects.slice(0, 3);

  return (
    <>
      {shown.map((subject, index) => (
        <span key={subject}>
          {index === 0 ? '' : ', '}
          <Go to={{ page: 'subject', build, subject }} go={go} className="va-from-go">
            {subject}
          </Go>
        </span>
      ))}
      {subjects.length > shown.length ? ` and ${number(subjects.length - shown.length)} more` : ''}
    </>
  );
}

/** The name, with a file's directory dimmed and its basename left alone. */
function Path({
  root,
  at,
}: {
  readonly root: Root;
  readonly at?: string | undefined;
}): ReactElement {
  const name = at ?? root.name;
  const cut = root.kind === 'file' ? name.lastIndexOf('/') + 1 : 0;

  return (
    <>
      {cut === 0 ? null : <span className="va-root-in">{name.slice(0, cut)}</span>}
      <span className="va-root-name">{name.slice(cut)}</span>
    </>
  );
}

/**
 * The declared location when it is the root file with something after it.
 *
 * `startsWith` and not equality, because the declaration carries a line and the
 * root does not. Guarded on the boundary so `button.tsx` does not swallow
 * `button.test.tsx`, which is one character of prefix away and a different file.
 */
function extending(declared: string | undefined, root: string): string | undefined {
  if (declared === undefined || !declared.startsWith(root)) return undefined;
  const after = declared.slice(root.length);
  return after === '' || after.startsWith(':') ? declared : undefined;
}

/**
 * What in the commit this change hangs from, and what else hangs from it.
 *
 * `null` when nothing does. That is the docket's alarm bands — nothing reaches
 * it, nothing explains it, no diff was read — and a line reading *from* with a
 * blank after it would be the page implying a cause it does not have.
 *
 * Read back out of the same arrangement the rail draws, so the file named here is
 * the heading the reviewer clicked to arrive.
 */
export function causesOf(build: BuildDetail, origin: Origin): readonly Group[] {
  return docketOf(build, originsOf(build).origins, 'story').filter(
    (group) =>
      group.root !== undefined &&
      group.changes.some(({ origin: each }) => each.component === origin.component),
  );
}

/**
 * Whether one of these causes is already the file the component is declared in.
 *
 * The `edited` rung's whole shape: the file the commit changed and the file the
 * component lives in are one path, and a head printing both says it twice while
 * dropping the line number off the copy a reviewer can open. So the cause line
 * carries the declaration and the declaration line stands down — asked here
 * rather than decided twice, so the two lines cannot both appear or both vanish.
 */
export function namesDeclaration(
  bands: readonly Group[],
  declared: string | undefined,
): boolean {
  return bands.some(
    (group) => group.root !== undefined && extending(declared, group.root.name) !== undefined,
  );
}

export function UnderRoot({
  bands,
  component,
  declared,
  build,
  go,
}: {
  readonly bands: readonly Group[];
  readonly component: string;
  /** Where the component is declared, when the docket knows — usually with a line. */
  readonly declared?: string | undefined;
  readonly build: string;
  readonly go: (route: Route) => void;
}): ReactElement | null {
  if (bands.length === 0) return null;

  return (
    <>
      {bands.map((group) => (
        <p key={group.title} className="va-from">
          <span className="va-from-mark">from</span>{' '}
          <span className={`va-root va-root-${group.root?.kind ?? 'file'}`} title={group.title}>
            {group.root === undefined ? (
              group.title
            ) : (
              <Path root={group.root} at={extending(declared, group.root.name)} />
            )}
          </span>
          <Siblings group={group} component={component} build={build} go={go} />
        </p>
      ))}
    </>
  );
}

/** The other changes the same cause made, which is the rest of the reviewer's edit. */
function Siblings({
  group,
  component,
  build,
  go,
}: {
  readonly group: Group;
  readonly component: string;
  readonly build: string;
  readonly go: (route: Route) => void;
}): ReactElement | null {
  const others = group.changes.filter(({ origin }) => origin.component !== component);
  if (others.length === 0) return null;

  return (
    <span className="va-note">
      {' '}
      — which also moved{' '}
      {others.map(({ origin, of }, index) => (
        <span key={origin.component}>
          {index === 0 ? '' : ', '}
          <Go to={{ page: 'change', build, change: origin.component }} go={go} className="va-from-go">
            {origin.component}
          </Go>{' '}
          <span className="va-num">{count(of ?? origin.appearances.length, 'render')}</span>
        </span>
      ))}
    </span>
  );
}
