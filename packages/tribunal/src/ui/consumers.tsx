/**
 * What happened to the things that draw this one.
 *
 * A reviewer who edited `ui/button.tsx` does not need to be told the button
 * changed. They wrote it. The question the screenshot exists to answer is the
 * other one — *and does everything that uses it still look right* — and the page
 * answered it by listing every component that moved anywhere near, alphabetised,
 * with no way to tell a card that reflowed from a nav that did something of its
 * own.
 *
 * The census names the consumers directly: `within` is what encloses this
 * component, per render, over the suite. Held to the renders where both are
 * drawn, that turns into one row per consumer and a state for each.
 *
 * ## Four states, and `cause` is what separates the middle two
 *
 * A component hash carries `cause` beside its bands — *its own content moved*,
 * as against *only its rect did*. That distinction is the whole answer here. A
 * card whose row grew because the button inside it got taller was **pushed**: it
 * is behaving correctly, it is the consequence a reviewer is checking for, and
 * printing it as a change would put five components on the alarm list for one
 * edit. A card that moved on its own did something the button does not explain.
 *
 * So: **held still** (no entry at all), **pushed** (an entry, `cause` false),
 * **moved** (an entry, `cause` true, and the bands say in what), and **not read**
 * — a render whose baseline carried no hashes, which is not a render where
 * anything held still.
 *
 * ## What it will not say
 *
 * That a consumer nobody rendered is fine. It says nothing about it, because
 * nothing looked: the rows here are renders, and a consumer with no story and no
 * route has none. The import graph knows those names and this does not read it.
 */

import type { ReactElement } from 'react';
import type { BuildDetail, Placement, SubjectView } from '../review-types.js';
import type { Route } from './route.js';
import { loudestFirst, senses } from './sense.js';
import { Go } from './shell.js';
import { count, number } from './text.js';

/** What one component that draws this one did, over the renders they share. */
export interface Consumer {
  readonly component: string;
  /** Renders drawing both, where the hashes were read. */
  readonly renders: number;
  /** Of those: no entry at all — nothing of it differs. */
  readonly still: number;
  /** Of those: only its rect moved. The consequence, behaving as it should. */
  readonly pushed: number;
  /** Of those: its own content moved, which this change does not explain. */
  readonly moved: number;
  /** The bands it moved in on its own, loudest first. Empty unless `moved`. */
  readonly bands: readonly string[];
  /** Renders drawing both where nothing compared hashes. */
  readonly unread: number;
}

/** One build's answer to *what did the things that draw this do*. */
export type Consuming = (component: string) => readonly Consumer[];

const NONE: readonly Consumer[] = [];

export function consumersOf(build: BuildDetail): Consuming {
  const census = build.composition;
  if (census === null) return () => NONE;

  const places = new Map(census.map((each) => [each.component, each]));
  const subjects = new Map(build.subjects.map((each) => [each.subject, each]));

  return (component) => {
    const place = places.get(component);
    if (place === undefined) return NONE;

    const drawn = new Set(place.subjects);
    const found = place.within.flatMap((name) => read(name, places.get(name), drawn, subjects));
    return [...found].sort(worstFirst);
  };
}

function read(
  component: string,
  place: Placement | undefined,
  drawn: ReadonlySet<string>,
  subjects: ReadonlyMap<string, SubjectView>,
): readonly Consumer[] {
  if (place === undefined) return [];

  const bands = new Set<string>();
  let renders = 0;
  let still = 0;
  let pushed = 0;
  let moved = 0;
  let unread = 0;

  for (const name of place.subjects) {
    if (!drawn.has(name)) continue;
    const subject = subjects.get(name);
    if (subject === undefined) continue;
    if (subject.moved === undefined) {
      unread += 1;
      continue;
    }

    renders += 1;
    const entry = subject.moved.find((each) => each.component === component);
    if (entry === undefined) still += 1;
    else if (!entry.cause) pushed += 1;
    else {
      moved += 1;
      for (const band of entry.bands) bands.add(band);
    }
  }

  if (renders === 0 && unread === 0) return [];
  return [{ component, renders, still, pushed, moved, bands: loudestFirst(bands), unread }];
}

/** Moved on its own, then pushed, then still. The alarm is at the top. */
function worstFirst(left: Consumer, right: Consumer): number {
  const rank = (each: Consumer): number => (each.moved > 0 ? 0 : each.pushed > 0 ? 1 : 2);
  return rank(left) - rank(right) || left.component.localeCompare(right.component);
}

/**
 * The consumers, worst first, under the count that answers the question.
 *
 * The summary line is the answer and the rows are the working. *2 held still, 2
 * pushed, 1 moved on its own* is what a reviewer came to the page for; which
 * card and in how many renders is what they open next.
 */
export function Consumers({
  found,
  build,
  changes,
  go,
}: {
  readonly found: readonly Consumer[];
  readonly build: string;
  /** Components with a change page of their own, so a link goes somewhere. */
  readonly changes: ReadonlySet<string>;
  readonly go: (route: Route) => void;
}): ReactElement | null {
  if (found.length === 0) return null;

  const moved = found.filter((each) => each.moved > 0).length;
  const pushed = found.filter((each) => each.moved === 0 && each.pushed > 0).length;
  const still = found.length - moved - pushed;

  return (
    <section className="va-consumers">
      <h2>Consumers</h2>
      <p className="va-consumers-tally">
        <strong>
          {count(found.length, 'component')} {found.length === 1 ? 'draws' : 'draw'} it
        </strong>
        {still === 0 ? null : <span> — {number(still)} held still</span>}
        {pushed === 0 ? null : <span> — {number(pushed)} pushed</span>}
        {moved === 0 ? null : (
          <span className="va-consumers-own"> — {number(moved)} moved on its own</span>
        )}
      </p>
      <ul className="va-consumers-list">
        {found.map((each) => (
          <li key={each.component} className={each.moved > 0 ? 'va-consumer-moved' : undefined}>
            {changes.has(each.component) ? (
              <Go
                to={{ page: 'change', build, change: each.component }}
                go={go}
                className="va-consumer-name"
              >
                {each.component}
              </Go>
            ) : (
              <span className="va-consumer-name">{each.component}</span>
            )}
            <span className="va-note">
              <Did each={each} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One consumer's state, as few words as the four cases allow.
 *
 * *Pushed, not changed* is three words carrying the finding: its rect moved and
 * its own content did not, so what a reviewer is looking at there is this edit
 * arriving rather than a second one to decide.
 */
function Did({ each }: { readonly each: Consumer }): ReactElement {
  const rest =
    each.unread === 0 ? null : <> · {number(each.unread)} not read</>;

  if (each.moved > 0) {
    return (
      <>
        moved in <em>{senses(each.bands)}</em> — {number(each.moved)} of {number(each.renders)}
        {rest}
      </>
    );
  }
  if (each.pushed > 0) {
    return (
      <>
        pushed, not changed — {number(each.pushed)} of {number(each.renders)}
        {rest}
      </>
    );
  }
  return (
    <>
      held still in all {number(each.renders)}
      {rest}
    </>
  );
}
