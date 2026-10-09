/**
 * Stories of one component that render one image, drawn where a reviewer reads
 * a build: counted on the docket, and side by side on the subject page.
 *
 * Its own module because both halves read one record, `BuildDetail.sameImage`,
 * and one family cut, [`family.ts`](../family.ts); the docket and the subject
 * page each mount one call. The server found the groups by stored key, so
 * nothing here compares an image. The grid lays the pictures out so the reviewer
 * can see it.
 */

import type { ReactElement } from 'react';
import { columnsOf, familyOf } from '../family.js';
import type { BuildDetail } from '../review-types.js';
import type { ReviewClient } from './client.js';
import type { Route } from './route.js';
import { Go } from './shell.js';
import { count } from './text.js';

/**
 * The docket's line: how many variations render an image a sibling also renders,
 * and which they are.
 *
 * Not a change and not counted among the changes. A story that paints what its
 * sibling paints is either an arm whose flag reaches no pixel or one state under
 * two names, and neither shows in a diff: both stories are `new` or both are
 * `unchanged`, and both are green.
 */
export function SameImageNote({
  build,
  go,
}: {
  readonly build: BuildDetail;
  readonly go: (route: Route) => void;
}): ReactElement | null {
  const groups = build.sameImage;
  if (groups.length === 0) return null;
  const stories = groups.reduce((total, group) => total + group.subjects.length, 0);

  return (
    <div className="va-same-image">
      <p>
        <strong>{count(stories, 'variation renders', 'variations render')} the same image</strong>{' '}
        as another story of its component. Each group is one picture under several names, so
        whatever varies between them does not reach a pixel.
      </p>
      <ul>
        {groups.map((group) => (
          <li key={group.subjects[0]}>
            <code>{group.family}</code>{' '}
            {group.subjects.map((subject, index) => (
              <span key={subject}>
                {index === 0 ? null : ' = '}
                <Go to={{ page: 'subject', build: build.build, subject }} go={go}>
                  {familyOf(subject).member}
                </Go>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How many stories of one component are drawn before the rest are counted. */
const TILES = 24;

/**
 * Every story of this subject's component, candidates side by side, in the
 * lattice's order, with the ones that are one image marked.
 *
 * Nothing for a subject that is the only story of its component: there is no
 * sibling to set it beside. A story with no candidate gets no tile, because a
 * broken picture beside a real one reads as a render that failed. It is counted
 * under the grid instead.
 */
export function Siblings({
  client,
  build,
  subject,
  go,
}: {
  readonly client: ReviewClient;
  readonly build: BuildDetail;
  readonly subject: string;
  readonly go: (route: Route) => void;
}): ReactElement | null {
  const { family } = familyOf(subject);
  const members = build.subjects.filter((each) => familyOf(each.subject).family === family);
  if (members.length < 2) return null;

  const drawn = members.filter((each) => each.has.after);
  const columns = columnsOf(
    drawn.map((each) => ({ subject: each.subject, member: familyOf(each.subject).member })),
    build.variations,
  );
  const groups = build.sameImage.filter((group) => group.family === family);
  const same = new Set(groups.flatMap((group) => group.subjects));
  const own = groups.find((group) => group.subjects.includes(subject));
  const member = (id: string): string => familyOf(id).member;

  return (
    <section className="va-siblings">
      <h4>
        Stories of <code>{family}</code>
      </h4>
      {groups.map((group) => (
        <p key={group.subjects[0]} className="va-note va-warned">
          {group === own
            ? `This story renders the same image as ${group.subjects.filter((each) => each !== subject).map(member).join(', ')}.`
            : `${group.subjects.map(member).join(', ')} render the same image.`}
        </p>
      ))}
      <ul className="va-sibling-grid">
        {columns.slice(0, TILES).map((column) => {
          const here = column.subject === subject;
          const picture = (
            <>
              <img src={client.imageUrl(build.build, column.subject, 'after')} alt={column.subject} loading="lazy" />
              <span className="va-sibling-name">{column.member}</span>
              {same.has(column.subject) ? <span className="va-sibling-mark">same image</span> : null}
            </>
          );
          return (
            <li
              key={column.subject}
              className={`va-sibling${here ? ' va-sibling-here' : ''}${same.has(column.subject) ? ' va-sibling-same' : ''}`}
            >
              {here ? picture : (
                <Go to={{ page: 'subject', build: build.build, subject: column.subject }} go={go}>
                  {picture}
                </Go>
              )}
            </li>
          );
        })}
      </ul>
      {columns.length <= TILES ? null : (
        <p className="va-note">{count(columns.length - TILES, 'further story', 'further stories')} not drawn.</p>
      )}
      {drawn.length === members.length ? null : (
        <p className="va-note">
          {count(members.length - drawn.length, 'story', 'stories')} kept no candidate, so{' '}
          {members.length - drawn.length === 1 ? 'it has' : 'they have'} no picture to set beside these.
        </p>
      )}
    </section>
  );
}
