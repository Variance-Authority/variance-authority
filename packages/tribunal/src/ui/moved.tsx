/**
 * The sentence the page was missing: what changed, rather than how much of it.
 *
 * Every other line on a change page is a fact *about* the difference — how many
 * renders carry it, whether the commit reaches it, whether the last build showed
 * it already. None of them is the difference. A reviewer asked to approve
 * something has to be told what it is, and *2 distinct differences, in 7 renders,
 * 30,373 px in total* tells them what was measured instead.
 *
 * [`sense.ts`](./sense.ts) does the reading. This draws the two halves of it, and
 * the second half is the one worth defending: a component the hashes say moved
 * and no region names is not a rendering detail, it is the picture failing on
 * exactly the change that matters most. An edit that reflows its neighbours
 * merges into one blob, the blob fits no component, and the name that comes back
 * is the document root — so the change with the widest consequence is the one
 * most likely to arrive anonymous. It is printed here as a finding rather than
 * left as a silence, because until it is, the page is confidently describing a
 * subject it never mentioned.
 */

import type { ReactElement } from 'react';
import type { SubjectView } from '../review-types.js';
import { howFar, placed, type Distance, type Ruler } from './distance.js';
import type { Handed } from './handed.js';
import type { Route } from './route.js';
import {
  senseOf,
  senseOfSubject,
  senses,
  type Across,
  type Elsewhere,
  type Sensed,
} from './sense.js';
import { Go } from './shell.js';
import { count } from './text.js';

/** How many render names are listed before the rest become a count. */
const NAMED = 4;

/**
 * The lead sentence: what this change is, before anything about its size.
 *
 * It goes first because it is the only line on the page a reviewer cannot decide
 * without. Nothing at all when no render here compared hashes — a page whose
 * loudest line said the baseline format is old would be spending it on a fact
 * about the store rather than about the change.
 */
export function MovedLead({
  component,
  across,
  handed,
}: {
  readonly component: string;
  readonly across: Across;
  /** Bands a parent owns, subtracted here and named by {@link HandedTo}. */
  readonly handed: readonly Handed[];
}): ReactElement | null {
  const given = new Set(handed.map((each) => each.band));
  const own = across.bands.filter((band) => !given.has(band));

  if (own.length > 0) {
    return (
      <p className="va-decide-lead">
        <strong>{component}</strong> moved in <em>{senses(own)}</em>.
      </p>
    );
  }

  if (across.measured === 0) return null;

  // Two different nothings. Everything this component moved in belongs to
  // somebody above it, which the lines under this name — against a component
  // whose own hashes held still in every render, which is collateral wearing a
  // name because the largest differing area happened to resolve here.
  return given.size > 0 ? (
    <p className="va-decide-lead">
      Nothing of <strong>{component}</strong>’s own moved.
    </p>
  ) : (
    <p className="va-decide-lead">
      Nothing in <strong>{component}</strong>’s own hashes moved: every render here was pushed by
      something else on the page.
    </p>
  );
}

/**
 * The bands this component was handed, each under the name that owns it.
 *
 * Directly under the lead, because it is the other half of the same sentence:
 * the lead now says less than the hashes did, and this is where the rest went.
 * The count is the evidence and not decoration — *moved in the 6 renders
 * ProductCard draws, still in the other 10* is the partition [`handed.ts`](./handed.ts)
 * found, and it is the whole reason the band is filed here rather than on the
 * component's own line.
 *
 * The holder is the link when the docket has a page for it. A reviewer reading
 * *what it announces is `ProductCard`’s* has exactly one next move.
 */
export function HandedTo({
  handed,
  build,
  changes,
  go,
}: {
  readonly handed: readonly Handed[];
  readonly build: string;
  /** Components with a change page of their own, so a link goes somewhere. */
  readonly changes: ReadonlySet<string>;
  readonly go: (route: Route) => void;
}): ReactElement | null {
  if (handed.length === 0) return null;

  return (
    <>
      {handed.map(({ band, holders, moved, held }) => (
        <p key={band} className="va-handed">
          <em>{senseOf(band)}</em> is{' '}
          {holders.map((holder, index) => (
            <span key={holder}>
              {index === 0 ? null : ' and '}
              {changes.has(holder) ? (
                <Go
                  to={{ page: 'change', build, change: holder }}
                  go={go}
                  className="va-handed-go"
                  title={`The decision belongs to ${holder}, which is a change on this build`}
                >
                  {holder}
                </Go>
              ) : (
                <strong>{holder}</strong>
              )}
            </span>
          ))}
          ’s.{' '}
          <span className="va-note">
            Moved in {count(moved, 'render')} {holders.length === 1 ? 'it draws' : 'they draw'},
            still in the other {held}.
          </span>
        </p>
      ))}
    </>
  );
}

/**
 * The rest of the reading: what the picture lost, and what moved beside it.
 *
 * Separate from {@link MovedLead} because it is detail and the lead is not, and
 * it renders nothing at all when there is no detail to give. A heading over a
 * sentence saying everything was ordinary is how a reader learns to skip the
 * place the exceptions will appear.
 */
export function WhatMoved({
  component,
  across,
  far,
  except,
}: {
  readonly component: string;
  readonly across: Across;
  /** How far each passenger is from this change, when a diff was read. */
  readonly far?: Ruler | undefined;
  /**
   * Names a section above already accounted for, left out of the list here.
   *
   * A consumer that reflowed is in both piles by construction — it draws this
   * component, and it moved in the same renders. Above it is placed against the
   * ones that held still, which is what makes it readable; here it would be a
   * name in an alphabetised list with a band beside it, saying the same thing
   * with the comparison removed.
   */
  readonly except?: ReadonlySet<string> | undefined;
}): ReactElement | null {
  const alongside = across.alongside.filter((other) => except?.has(other.component) !== true);
  const quiet =
    across.missedIn.length === 0 && alongside.length === 0 && across.unmeasured.length === 0;
  if (quiet) return null;

  return (
    <section className="va-moved">
      <h2>What moved with it</h2>

      {across.missedIn.length === 0 ? null : (
        <p className="va-moved-lost">
          In {count(across.missedIn.length, 'render')} no region carries{' '}
          <strong>{component}</strong> — the difference merged into a larger area and resolved
          elsewhere, so the picture there is not a picture of this.{' '}
          <Renders subjects={across.missedIn} />
        </p>
      )}

      {alongside.length === 0 ? null : (
        <>
          {/* Only under the paragraph above. With nothing between them the two
              headings stack, and a heading whose whole job is to separate is
              noise when there is nothing on the other side of it. */}
          {across.missedIn.length === 0 ? null : <h3>Moving beside it</h3>}
          <ul className="va-moved-with">
            {alongside.map((other) => (
              <li key={other.component}>
                <span className="va-moved-name">{other.component}</span>{' '}
                <span className="va-note">{senses(other.bands)}</span>
                <Far component={other.component} far={far} />
              </li>
            ))}
          </ul>
          <Unplaced
            anchor={component}
            components={alongside.map((other) => other.component)}
            far={far}
          />
        </>
      )}

      {across.unmeasured.length === 0 ? null : (
        <p className="va-note">
          {count(across.unmeasured.length, 'render')} compared against a baseline carrying no
          component hashes, so nothing above was measured there.{' '}
          <Renders subjects={across.unmeasured} />
        </p>
      )}
    </section>
  );
}

/**
 * The same reading for one render, where the join is worth showing in full.
 *
 * A change page folds the renders together and answers *what did this component
 * do*. Here both tiers are in front of the reviewer at once, so the useful shape
 * is the disagreement: which names the hashes and the regions agree on, which the
 * hashes hold alone, and which the regions hold alone. The third pile is the one
 * a reader is most likely to get backwards — a component a region named while its
 * own hashes held still was pushed, and calling that a change is the ranking this
 * project exists to correct.
 */
export function MovedHere({
  subject,
  anchor,
  far,
}: {
  readonly subject: SubjectView;
  /** The change this render is filed under, which `far` measures from. */
  readonly anchor?: string | undefined;
  readonly far?: Ruler | undefined;
}): ReactElement {
  const sense = senseOfSubject(subject);

  if (!sense.measured) {
    return (
      <p className="va-note">
        This render was compared against a baseline carrying no component hashes, so nothing says
        which components moved — only where the pixels differ.
      </p>
    );
  }

  if (sense.moved.length === 0) {
    return (
      <p className="va-note">
        Both revisions were read and every component hash matched. Whatever differs here is beneath
        the semantic tier, or belongs to a part of the page the walk assigned no component to.
      </p>
    );
  }

  return (
    <>
      <ul className="va-moved-list">
        {sense.moved.map((entry) => (
          <Moved key={entry.component} entry={entry} anchor={anchor} far={far} />
        ))}
      </ul>
      {anchor === undefined ? null : (
        <Unplaced
          anchor={anchor}
          components={sense.moved.map((entry) => entry.component)}
          far={far}
        />
      )}
      {sense.pushed.length === 0 ? null : (
        <p className="va-note">
          A region names {sense.pushed.join(', ')}, whose own hashes held still: pushed by
          something else, not edited.
        </p>
      )}
    </>
  );
}

/** One component, its bands, and whether the picture found it. */
function Moved({
  entry,
  anchor,
  far,
}: {
  readonly entry: Sensed;
  readonly anchor?: string | undefined;
  readonly far?: Ruler | undefined;
}): ReactElement {
  return (
    <li className={entry.cause ? 'va-moved-row' : 'va-moved-row va-moved-passenger'}>
      <span className="va-moved-name">{entry.component}</span>
      <span className="va-note">
        {entry.presence === undefined ? senses(entry.bands) : entry.presence}
      </span>
      {/* Distance to itself is not a measurement. The row the rest are measured
          from would otherwise carry `same file`, which is true of every component
          and its own declaration and says nothing about this one. */}
      {entry.component === anchor ? null : <Far component={entry.component} far={far} />}
      {entry.drawn ? null : (
        <span
          className="va-mark va-alarm"
          title="The hashes say this component moved, and no region in this render carries its name — the difference merged into a larger area and resolved elsewhere."
        >
          no region
        </span>
      )}
    </li>
  );
}

/** A few render names, then a count — a list of twenty is not read as evidence. */
function Renders({ subjects }: { readonly subjects: readonly string[] }): ReactElement {
  const named = subjects.slice(0, NAMED);
  const rest = subjects.length - named.length;

  return (
    <span className="va-note" title={subjects.join(', ')}>
      {named.join(', ')}
      {rest === 0 ? '' : ` and ${count(rest, 'other')}`}
    </span>
  );
}

/**
 * The renders this change moved in that the docket files under another name.
 *
 * The gap between the two tiers, printed. A subject belongs to whichever
 * component its leading *region* resolved to, and a commit that edits a button
 * and a price string in the same card files every card under whichever of the two
 * drew the larger box — so the button's page can list seven renders of the twelve
 * its hashes moved in, and be silent about five.
 *
 * Silent is the problem. Approving here decides the renders here; the five stay
 * open under a name nobody looking for this change would open. So they are named,
 * with the change they were filed under, and with the one sentence that keeps a
 * reviewer from assuming the button is finished.
 */
export function MovedElsewhere({
  component,
  found,
  build,
  go,
}: {
  readonly component: string;
  readonly found: readonly Elsewhere[];
  readonly build: string;
  readonly go: (route: Route) => void;
}): ReactElement | null {
  if (found.length === 0) return null;

  return (
    <section className="va-moved">
      <h2>Also moved, filed elsewhere</h2>
      <p className="va-moved-lost">
        <strong>{component}</strong>’s hashes moved in {count(found.length, 'further render')}, where
        a larger difference took the name. Deciding this change does not decide them.
      </p>
      <ul className="va-moved-list">
        {found.map((each) => (
          <li key={each.subject} className="va-moved-row">
            <Go
              to={{ page: 'subject', build, subject: each.subject }}
              go={go}
              className="va-moved-name"
            >
              {each.subject}
            </Go>
            <span className="va-note">
              {each.filedUnder === undefined ? 'no component named the cause' : `under ${each.filedUnder}`}
            </span>
            {each.drawn ? null : (
              <span
                className="va-mark va-alarm"
                title="No region in that render carries this component either, so its picture is not a picture of this change."
              >
                no region
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How far a component is from the change, when the records place it. */
function Far({
  component,
  far,
}: {
  readonly component: string;
  readonly far?: Ruler | undefined;
}): ReactElement | null {
  const said = distanceOf(far, component);
  if (said === undefined) return null;

  return <span className="va-moved-far">{said}</span>;
}

function distanceOf(far: Ruler | undefined, component: string): string | undefined {
  const distance = far?.(component);
  return distance === undefined ? undefined : howFar(distance);
}

/**
 * What the list could not place, said once instead of on every row.
 *
 * A reader who sees a distance on two rows and nothing on the other seven will
 * read the silence as *near*, which is the one thing it does not mean. So the
 * absence is stated — as a fact about the graph, not about the components, and
 * without claiming they are unrelated. Nothing at all when the run carried no
 * diff: `unknown` is the whole page's condition and the page says it elsewhere.
 */
function Unplaced({
  anchor,
  components,
  far,
}: {
  readonly anchor: string;
  readonly components: readonly string[];
  readonly far?: Ruler | undefined;
}): ReactElement | null {
  if (far === undefined) return null;

  const distances = components.map((component): Distance => far(component));
  const lost = distances.filter((distance) => distance.kind === 'unreached').length;
  if (lost === 0) return null;

  const some = distances.some((distance) => placed(distance));

  return (
    <p className="va-note">
      Nothing the commit walked arrives at {some ? count(lost, 'other') : 'any of these'}, and no
      file is recorded for them either, so how far they are from <strong>{anchor}</strong> is not
      something this build measured.
    </p>
  );
}
