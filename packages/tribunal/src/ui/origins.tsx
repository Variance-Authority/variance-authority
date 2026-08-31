/**
 * The docket: every change in the build, banded, in a rail beside the one open.
 *
 * This was a stack of cards. Each carried a component, a file path, a ratio and a
 * fingerprint, and a reviewer arriving at a build of eleven changes met eleven of
 * them stacked vertically — the second one below the fold, the divergence panel
 * that would have told them they had already seen four of these nine thousand
 * pixels further down. A page cannot be both the index and the entry, and when it
 * tries the index wins the top of the screen and says nothing.
 *
 * So the list stopped carrying the story. A row says which change it is, how far
 * it went, and the single thing about it a reviewer would want before opening it:
 * that nothing reaches it, that build 5 showed it to them already, that it is
 * done. Everything else moved to [`change.tsx`](./change.tsx), where there is room
 * to say it beside the picture.
 *
 * ## The bands are the order
 *
 * A list of changes sorted by pixels answers *which of these is biggest*, and
 * nobody has ever needed to know that. The first band is the changes nothing in
 * the commit reaches — the ones that are either a real regression or a gap in the
 * graph, and either way the ones worth the reviewer's first hour. Then the ones
 * they asked for, then the ones the diff cannot name, then what is already
 * decided. Within a band, alphabetical: a reviewer looking for `Button` should
 * find it where `Button` goes, not wherever this run's pixel counts put it.
 *
 * The other orders exist because a band is a claim and a reviewer is allowed to
 * disbelieve it. [`order.ts`](./order.ts) holds them all.
 */

import type { ReactElement } from 'react';
import type { BuildDetail, SubjectView } from '../review-types.js';
import type { Crossing } from './crossing.js';
import { unforeseen } from './foreseen.js';
import { originsOf, shapesOf, sourceOf, type Origin } from './grouping.js';
import { docketOf, ORDERS, type Group } from './order.js';
import { RootHeading } from './root.js';
import type { Order, Route } from './route.js';
import { Go } from './shell.js';
import { senseOfSubject } from './sense.js';
import { count, magnitude, number } from './text.js';

export function OriginsPanel({
  build,
  crossing,
  order,
  selected,
  go,
}: {
  readonly build: BuildDetail;
  readonly crossing: Crossing;
  readonly order: Order;
  /** The change on the stage, so the rail can say which row it is. */
  readonly selected?: string | undefined;
  readonly go: (route: Route) => void;
}): ReactElement {
  const { origins, unattributed } = originsOf(build);
  const renders = origins.reduce((total, origin) => total + origin.appearances.length, 0);

  if (origins.length === 0 && unattributed.length === 0) {
    return (
      <div className="va-rail-empty va-note">
        Nothing in this build changed, so there is nothing to approve.
      </div>
    );
  }

  return (
    <>
      <div className="va-rail-head">
        <p className="va-rail-tally">
          {count(origins.length, 'change')} · {count(renders, 'render')}
        </p>
        <Sorting order={order} build={build.build} go={go} />
      </div>

      <Unreached build={build} go={go} />

      <div className="va-rail-list va-scroll">
        {docketOf(build, origins, order).map((group) => (
          <Band
            key={group.lane + group.title}
            group={group}
            detail={build}
            build={build.build}
            crossing={crossing}
            selected={selected}
            go={go}
          />
        ))}

        {unattributed.length === 0 ? null : (
          <Unattributed subjects={unattributed} build={build.build} go={go} />
        )}
      </div>
    </>
  );
}

/**
 * Whether anything moved that the commit cannot reach.
 *
 * The empty case is printed, and it is the only place on this surface where an
 * empty list is worth a sentence: *nothing moved outside what you edited* is the
 * strongest thing a build can say, a reviewer cannot derive it from a docket of
 * changes that are all accounted for, and its absence is what makes the other
 * case legible when it happens.
 *
 * Silent when the run walked no diff. Then there is no prediction to have kept.
 */
function Unreached({
  build,
  go,
}: {
  readonly build: BuildDetail;
  readonly go: (route: Route) => void;
}): ReactElement | null {
  const loose = unforeseen(build);
  if (loose === null) return null;

  if (loose.length === 0) {
    return <p className="va-foreseen va-note">Everything that moved is under a file this commit changed.</p>;
  }

  return (
    <p className="va-foreseen va-note va-foreseen-off">
      <span className="va-num">{number(loose.length)}</span> moved with nothing in this commit
      above{' '}
      {loose.slice(0, 3).map((subject, index) => (
        <span key={subject}>
          {index === 0 ? '— ' : ', '}
          <Go to={{ page: 'subject', build: build.build, subject }} go={go} className="va-from-go">
            {subject}
          </Go>
        </span>
      ))}
      {loose.length > 3 ? ` and ${number(loose.length - 3)} more` : ''}
    </p>
  );
}

/** The order picker: four addresses, one of which is the one you are at. */
function Sorting({
  order,
  build,
  go,
}: {
  readonly order: Order;
  readonly build: string;
  readonly go: (route: Route) => void;
}): ReactElement {
  return (
    <div className="va-sorting" role="group" aria-label="Order the changes">
      {ORDERS.map(({ order: each, label, why }) => (
        <Go
          key={each}
          to={{ page: 'build', build, order: each }}
          go={go}
          className={each === order ? 'va-sort va-on' : 'va-sort'}
          title={why}
        >
          {label}
        </Go>
      ))}
    </div>
  );
}

/** One band: the claim, the count, the rows. */
function Band({
  group,
  detail,
  build,
  crossing,
  selected,
  go,
}: {
  readonly group: Group;
  readonly detail: BuildDetail;
  readonly build: string;
  readonly crossing: Crossing;
  readonly selected?: string | undefined;
  readonly go: (route: Route) => void;
}): ReactElement {
  return (
    <section className={`va-band va-band-${group.lane}`}>
      <RootHeading group={group} detail={detail} go={go} />
      <ul>
        {group.changes.map(({ origin, of }) => (
          <Row
            key={origin.component}
            origin={origin}
            {...(of === undefined ? {} : { of })}
            {...(group.root === undefined ? {} : { from: group.root.name })}
            build={build}
            crossing={crossing}
            open={origin.component === selected}
            go={go}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * One change, in a row a reviewer can scan a column of.
 *
 * Four facts and at most one mark. The fingerprint is not one of them — it is an
 * identity, not a finding, and it was on the third line of every card in the
 * version of this surface that told nobody anything. What replaces it is the
 * count of distinct shapes, which is the part of the same record a reviewer can
 * act on: one shape across eleven renders is one decision, and nine shapes across
 * eleven is a component whose renders each absorbed the edit their own way.
 *
 * The fourth fact is the source, and it is fourth rather than absent because the
 * band above it no longer says anything about where these came from. `CardFooter`
 * sat under *something you edited hands these what they draw* for a build and a
 * half with `ProductCard` in the store the whole time.
 */
function Row({
  origin,
  of,
  from,
  build,
  crossing,
  open,
  go,
}: {
  readonly origin: Origin;
  /** Renders this band's cause accounts for, when it does not account for all. */
  readonly of?: number;
  /** The cause the heading above already names, so the row does not repeat it. */
  readonly from?: string;
  readonly build: string;
  readonly crossing: Crossing;
  readonly open: boolean;
  readonly go: (route: Route) => void;
}): ReactElement {
  const shapes = shapesOf(origin.appearances).size;
  const decided = origin.appearances.filter(({ subject }) => subject.decision !== null).length;

  return (
    <li className={open ? 'va-row va-here' : 'va-row'}>
      <Go
        to={{ page: 'change', build, change: origin.component }}
        go={go}
        className="va-row-link"
        title={origin.file ?? origin.component}
      >
        <span className="va-row-name">{origin.component}</span>
        <span className="va-row-spread va-note">
          {of === undefined
            ? count(origin.appearances.length, 'render')
            : `${number(of)} of ${count(origin.appearances.length, 'render')}`}
          {shapes > 1 ? ` · ${count(shapes, 'shape')}` : ''}
        </span>
        <span className="va-row-size va-num">{number(origin.pixels)} px</span>
        <RowMark origin={origin} crossing={crossing} decided={decided} />
        <Source origin={origin} {...(from === undefined ? {} : { from })} />
      </Go>
    </li>
  );
}

/**
 * Where the change came from, by name.
 *
 * Nothing is derived here and nothing is phrased: [`sourceOf`](./grouping.js)
 * reads the owner, the file or the token off the movement the run wrote, and
 * this prints the list. A row with no source line is a row the run recorded
 * nothing for and the docket has no file for either — which is a fact about the
 * record, and is drawn as the empty space it is rather than as a sentence
 * apologising for it.
 */
function Source({
  origin,
  from,
}: {
  readonly origin: Origin;
  readonly from?: string;
}): ReactElement | null {
  // Minus what the heading over it already said. Under `ui/button.tsx`, an
  // `edited` row's source *is* `ui/button.tsx`, and printing it again spends the
  // row's third line saying the band's name back to the reader. The rows that
  // still have something to say — the chain an owner reaches through — keep it.
  const names = sourceOf(origin).filter((name) => name !== from);
  if (names.length === 0) return null;

  const say = names.join(', ');
  // Ellipsised at the rail's width, so the full text has to be somewhere. This
  // is the one thing a `title` is for: the same string, not a different one.
  return (
    <span className="va-row-from" title={say}>
      {say}
    </span>
  );
}

/**
 * The one thing worth knowing before opening this change, or nothing.
 *
 * At most one, and in this order, because a row with four badges on it is a row
 * nobody reads. Already-decided outranks everything: there is no work here. Then
 * *you have seen this*, which is the row a reviewer can skip. Then the strandings,
 * which is the row they cannot.
 */
function RowMark({
  origin,
  crossing,
  decided,
}: {
  readonly origin: Origin;
  readonly crossing: Crossing;
  readonly decided: number;
}): ReactElement | null {
  if (decided === origin.appearances.length) {
    return <span className="va-mark va-approved">decided</span>;
  }

  if (crossing.state === 'ready') {
    const again = origin.appearances.filter(
      ({ subject }) => crossing.of(subject.subject)?.shift === 'again',
    ).length;
    if (again === origin.appearances.length) {
      return (
        <span className="va-mark va-known" title={`Every render of this was in build ${crossing.earlier.build} too, with the same difference`}>
          seen in {crossing.earlier.build}
        </span>
      );
    }
  }

  if ((origin.stranded ?? []).length > 0) {
    return (
      <span className="va-mark va-alarm" title="The commit reaches nothing at all in some of these renders">
        unreached
      </span>
    );
  }

  if (decided > 0) {
    return (
      <span className="va-mark va-note">
        {number(decided)}/{number(origin.appearances.length)}
      </span>
    );
  }

  return null;
}

/**
 * The changed renders no *region* claimed — which is not the same as unexplained.
 *
 * Their own band and never folded into one: a difference with nothing named as
 * its cause has no change to be approved under, and putting it in somebody else's
 * group would hand a reviewer an unrelated edit to approve it beneath.
 *
 * The band used to say nothing had named these. That was false on every build
 * carrying component hashes, and false in the direction that costs the most: a
 * region is named by resolving the box the pixels drew, so it fails exactly when
 * an edit reflows its neighbours and the difference merges into one blob. The
 * hashes are still there, still per component, and they usually name the cause
 * outright. What is missing is a *box*, not a name — so the name is on the row.
 */
function Unattributed({
  subjects,
  build,
  go,
}: {
  readonly subjects: readonly SubjectView[];
  readonly build: string;
  readonly go: (route: Route) => void;
}): ReactElement {
  return (
    <section className="va-band va-band-orphan">
      <h3>
        No region named these <span className="va-num">{number(subjects.length)}</span>
      </h3>
      <ul>
        {subjects.map((subject) => (
          <li key={subject.subject} className="va-row">
            <Go
              to={{ page: 'subject', build, subject: subject.subject }}
              go={go}
              className="va-row-link"
              title={magnitude(subject)}
            >
              <span className="va-row-name">{subject.subject}</span>
              <Blamed subject={subject} />
              <span className="va-row-size va-num">{number(subject.changedPixels)} px</span>
            </Go>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What the hashes name in a render the regions could not.
 *
 * Falls back to the region count when the baseline carried no hashes, because
 * absent is not empty: a run that never measured this has not established that
 * nothing caused the difference, and a row printing an empty list would say it
 * had.
 */
function Blamed({ subject }: { readonly subject: SubjectView }): ReactElement {
  const sense = senseOfSubject(subject);
  const causes = sense.moved.filter((entry) => entry.cause).map((entry) => entry.component);

  if (causes.length === 0) {
    return (
      <span className="va-row-spread va-note">{count(subject.regions.length, 'region')}</span>
    );
  }

  return (
    <span className="va-row-spread va-note" title={causes.join(', ')}>
      hashes name {causes.slice(0, 2).join(', ')}
      {causes.length > 2 ? ` +${String(causes.length - 2)}` : ''}
    </span>
  );
}
