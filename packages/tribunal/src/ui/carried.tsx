/**
 * The other changes riding in the same picture as this one.
 *
 * A decision is taken on a *subject*, and approving one promotes the whole
 * candidate image as the new baseline. So a render that carries this change and
 * two others settles all three, under whichever of them the reviewer happened to
 * open. Nothing on the page said so, and the reviewer had no way to find out: the
 * docket files each render under one change, and the other two are on their own
 * pages with their own approve buttons that have already been pressed by proxy.
 *
 * At one component and a dozen renders that is a small hazard. A button drawn in
 * three thousand shots is where it stops being one — the batch is the only way to
 * decide it, and the batch is exactly what makes the co-carried change invisible.
 *
 * ## What counts as another change here
 *
 * `cause` on the component hashes, which is *its own content moved* rather than
 * *its box was pushed*. A container that reflowed is not a second change and
 * listing it would put six framework wrappers on every render. The named few that
 * come back are the components a reviewer would have opened a page for.
 *
 * ## What it will not say
 *
 * That a render carries only this change, when nothing compared its hashes. A
 * baseline without component digests answers *not read*, and reading that as
 * *nothing else is here* is the reassurance this whole surface must never give.
 */

import type { ReactElement } from 'react';
import type { BuildDetail } from '../review-types.js';
import type { Route } from './route.js';
import { Go } from './shell.js';
import { count, number } from './text.js';

/** One other component causing a difference in renders this change is decided in. */
export interface Carried {
  readonly component: string;
  /** Renders of this change it also moved in, in the order they were given. */
  readonly subjects: readonly string[];
}

/** What else is in the pictures a decision here would promote. */
export interface Carrying {
  /** The other causes, widest first. */
  readonly others: readonly Carried[];
  /** Renders whose hashes were read and name no other cause. */
  readonly alone: readonly string[];
  /** Renders whose hashes were read and name at least one. */
  readonly shared: readonly string[];
  /** Renders where nothing compared hashes, which is neither of the above. */
  readonly unread: readonly string[];
  /** The other causes in one render. */
  readonly at: (subject: string) => readonly string[];
}

export function carriedWith(
  build: BuildDetail,
  component: string,
  subjects: readonly string[],
): Carrying {
  const read = new Map(build.subjects.map((each) => [each.subject, each.moved]));
  const others = new Map<string, string[]>();
  const alone: string[] = [];
  const shared: string[] = [];
  const unread: string[] = [];
  const at = new Map<string, readonly string[]>();

  for (const subject of subjects) {
    const moved = read.get(subject);
    if (moved === undefined) {
      unread.push(subject);
      continue;
    }

    const causes = moved
      .filter((each) => each.cause && each.component !== component)
      .map((each) => each.component)
      .sort();

    at.set(subject, causes);
    if (causes.length === 0) alone.push(subject);
    else shared.push(subject);
    for (const name of causes) {
      const seen = others.get(name);
      if (seen === undefined) others.set(name, [subject]);
      else seen.push(subject);
    }
  }

  return {
    others: [...others.entries()]
      .map(([name, where]) => ({ component: name, subjects: where }))
      .sort((left, right) => right.subjects.length - left.subjects.length ||
        left.component.localeCompare(right.component)),
    alone,
    shared,
    unread,
    at: (subject) => at.get(subject) ?? [],
  };
}

/**
 * What a press of Approve settles beyond the change it is under.
 *
 * The button says *Approve this change (7)* and promotes seven whole pictures.
 * Four of those seven also hold a `CardFooter` that moved on its own, and it has
 * a page and an approve button of its own that nobody pressed — so the reviewer
 * decides it here, under a heading with another component's name on it, and the
 * `CardFooter` page afterwards reports renders already baselined against a
 * decision it never recorded.
 *
 * Named rather than counted, and linked: the instruction the sentence implies is
 * *go and look at that one first*, and it is one click away.
 */
export function AlsoCarries({
  carrying,
  renders,
  build,
  changes,
  go,
}: {
  readonly carrying: Carrying;
  /** Renders on this page, which the shared count is a fraction of. */
  readonly renders: number;
  readonly build: string;
  /** Components with a change page of their own, so a link goes somewhere. */
  readonly changes: ReadonlySet<string>;
  readonly go: (route: Route) => void;
}): ReactElement | null {
  if (carrying.others.length === 0 && carrying.unread.length === 0) return null;

  return (
    <p className="va-carries">
      {carrying.others.length === 0 ? null : (
        <>
          <strong>
            {number(carrying.shared.length)} of {count(renders, 'render')}
          </strong>{' '}
          also carry{' '}
          {carrying.others.map((other, index) => (
            <span key={other.component}>
              {index === 0 ? '' : index === carrying.others.length - 1 ? ' and ' : ', '}
              {changes.has(other.component) ? (
                <Go
                  to={{ page: 'change', build, change: other.component }}
                  go={go}
                  className="va-carries-go"
                >
                  {other.component}
                </Go>
              ) : (
                <strong>{other.component}</strong>
              )}
              <span className="va-note"> ({number(other.subjects.length)})</span>
            </span>
          ))}
          . A decision is taken on the whole picture, so approving here accepts those in the same
          renders — before anyone opened their page.{' '}
        </>
      )}
      {carrying.unread.length === 0 ? null : (
        <span className="va-note">
          {count(carrying.unread.length, 'render')} compared against a baseline with no component
          hashes, so nothing says what else is in {carrying.unread.length === 1 ? 'it' : 'them'}.
        </span>
      )}
    </p>
  );
}
