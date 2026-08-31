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

/** Moved on its own, then only-shifted, then unchanged. */
function worstFirst(left: Consumer, right: Consumer): number {
  const rank = (each: Consumer): number => (each.moved > 0 ? 0 : each.pushed > 0 ? 1 : 2);
  return rank(left) - rank(right) || left.component.localeCompare(right.component);
}

/**
 * How many names a line will carry before it stops being a line a reviewer reads.
 *
 * A button in three thousand shots has more consumers than fit anywhere, and the
 * ones being elided here are the two states nobody needs a name for. What is
 * never elided is the pile above: a consumer that moved on its own gets a row of
 * its own however many of them there are, because that pile is the review.
 */
const NAMES = 8;

/**
 * What the things drawing this one did — the exceptions named, the rest counted.
 *
 * The first draft gave every consumer a row and led with *2 held still, 2 pushed,
 * 1 moved on its own*, which is three numbers and no names: the reviewer's
 * question is **which**, and a count answers it only if they then read five rows
 * and sort them back into three piles themselves. It also spent a row each on
 * consumers that did nothing, which is the pile with the least to say and, at any
 * real scale, the largest.
 *
 * So the shape is inverted. A consumer that moved in a way this change does not
 * explain gets a row, its bands and its render count — that is the review. The
 * ones that only shifted and the ones that held still are named on one line each
 * and nothing more, because *`MainNav` was drawn eight times and is unchanged* is
 * a fact worth having and not a fact worth eight lines of screen.
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

  const moved = found.filter((each) => each.moved > 0);
  const shifted = found.filter((each) => each.moved === 0 && each.pushed > 0);
  const still = found.filter((each) => each.moved === 0 && each.pushed === 0 && each.renders > 0);
  const unread = found.filter((each) => each.renders === 0);

  return (
    <section className="va-consumers">
      <h2>Consumers</h2>

      <p className="va-consumers-tally">
        {moved.length === 0 ? (
          <strong>
            Nothing of the {count(found.length, 'component')} that draw it moved on its own.
          </strong>
        ) : (
          <strong className="va-consumers-own">
            {names(moved)} moved in {moved.length === 1 ? 'a way' : 'ways'} this change does not
            explain.
          </strong>
        )}
      </p>

      {moved.length === 0 ? null : (
        <ul className="va-consumers-list">
          {moved.map((each) => (
            <li key={each.component} className="va-consumer-moved">
              <Name each={each} build={build} changes={changes} go={go} />
              <span className="va-note">
                <em>{senses(each.bands)}</em> — {number(each.moved)} of {number(each.renders)}
                {each.unread === 0 ? null : <> · {number(each.unread)} not read</>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* The other three piles, one line each. Named, because *2 pushed* sends a
          reviewer looking for which two, and counted rather than listed because
          at scale these are the hundreds. */}
      <p className="va-consumers-rest">
        {shifted.length === 0 ? null : (
          <span>
            Only their box moved: <Named of={shifted} />.{' '}
          </span>
        )}
        {still.length === 0 ? null : (
          <span>
            Unchanged: <Named of={still} />.{' '}
          </span>
        )}
        {unread.length === 0 ? null : (
          <span className="va-alarm-text">
            Nothing compared hashes for <Named of={unread} unread={false} />, so no render says
            what {unread.length === 1 ? 'it' : 'they'} did.
          </span>
        )}
      </p>
    </section>
  );
}

function Name({
  each,
  build,
  changes,
  go,
}: {
  readonly each: Consumer;
  readonly build: string;
  readonly changes: ReadonlySet<string>;
  readonly go: (route: Route) => void;
}): ReactElement {
  if (!changes.has(each.component)) {
    return <span className="va-consumer-name">{each.component}</span>;
  }
  return (
    <Go
      to={{ page: 'change', build, change: each.component }}
      go={go}
      className="va-consumer-name"
      title={`${each.component} is a change on this build, with a decision of its own`}
    >
      {each.component}
    </Go>
  );
}

/**
 * The names, capped, with the remainder said rather than dropped — and with the
 * renders nobody read carried on the name they belong to.
 *
 * *Unchanged* over a consumer with two renders read and one not is true of the
 * two and says nothing about the third, and a reader has no way to tell that
 * from a clean three. The count goes on the name because that is the only place
 * it stays attached once the pile is a line.
 */
function Named({
  of,
  unread = true,
}: {
  readonly of: readonly Consumer[];
  /** Off where the sentence around it already says nothing was read. */
  readonly unread?: boolean;
}): ReactElement {
  const shown = of.slice(0, NAMES);
  const rest = of.length - shown.length;
  return (
    <span title={of.map((each) => each.component).join(', ')}>
      {shown.map((each, index) => (
        <span key={each.component}>
          {index === 0 ? '' : ', '}
          {each.component}
          {!unread || each.unread === 0 ? null : ` (${number(each.unread)} not read)`}
        </span>
      ))}
      {rest === 0 ? null : ` and ${number(rest)} more`}
    </span>
  );
}

/** The same, in a sentence that starts with them. */
function names(of: readonly Consumer[]): string {
  const shown = of.slice(0, NAMES).map((each) => each.component);
  const rest = of.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${number(rest)} more`;
  if (shown.length === 1) return shown[0] ?? '';
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1] ?? ''}`;
}
