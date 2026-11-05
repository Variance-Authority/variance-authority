// compass: variance-authority.review
import type { ReactElement } from 'react';
import type { BuildDetail } from '../review-types.js';
import type { Crossing } from './crossing.js';
import { originsOf, type Origin } from './grouping.js';
import { Impact } from './impact.js';
import type { Route } from './route.js';
import { SameImageNote } from './same-image.js';
import { Go } from './shell.js';
import { count, number } from './text.js';

/**
 * The stage with nothing open: a short reading of the build, and where to go.
 *
 * Everything a reader could want past this has an address, and putting it here
 * instead is how the previous version of this page came to be read top to bottom
 * by nobody.
 *
 * Under the heading there used to be a definition — *a change is a component and
 * every render it moved in, one decision covers all of them* — printed on every
 * build of every project, in the position a reader gives their second glance to.
 * It is true and it is the same sentence every time, which makes it the most
 * expensive line on the page. The heading already counts the renders; the tally,
 * the commits and the diff below are about this build.
 */
export function Opening({
  build,
  crossing,
  missing,
  go,
}: {
  readonly build: BuildDetail;
  readonly crossing: Crossing;
  /** The change the address named, when this build has none under it. */
  readonly missing?: string | undefined;
  readonly go: (route: Route) => void;
}): ReactElement {
  const { origins, unattributed } = originsOf(build);

  return (
    <div className="va-stage va-scroll">
      <div className="va-page va-opening">
        {missing === undefined ? null : (
          <p className="va-failure">
            This build has no change under <strong>{missing}</strong>. It may have been decided and
            the baseline promoted, or the link may be from another build.
          </p>
        )}

        <h1>{headline(build, origins)}</h1>
        {origins.length === 0 ? <Still verdicts={build.verdicts} /> : null}

        {unattributed.length === 0 ? null : (
          <p className="va-note">
            {count(unattributed.length, 'render')} moved with no component named as the cause by a
            region.
          </p>
        )}

        <SameImageNote build={build} go={go} />
        <Since crossing={crossing} />
        <Impact build={build} crossing={crossing} />

        <p className="va-opening-links">
          <Go to={{ page: 'run', build: build.build }} go={go} className="va-mode">
            What this run read →
          </Go>
          <span className="va-note">
            Reach, the crossing in full, the variation lattice, and what nothing looked at.
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * The opening line, from the count the header gives.
 *
 * No change filed is not nothing to do: a first run files none, and neither does
 * a render that changed with no component named, so `pending` decides whether
 * there is work. The changes are named only when they hold all of it: *from 1
 * change* over a render no change holds would be false.
 */
function headline(build: BuildDetail, origins: readonly Origin[]): string {
  if (build.pending === 0) {
    return origins.length === 0 ? 'Nothing to review' : `${count(origins.length, 'change')}, all decided`;
  }
  const open = origins
    .map((origin) => origin.appearances.filter((each) => each.subject.decision === null))
    .filter((appearances) => appearances.length > 0);
  const held = new Set(open.flat().map((each) => each.subject.subject));
  const renders = `${count(build.pending, 'render')} to review`;
  return held.size === build.pending ? `${renders}, from ${count(open.length, 'change')}` : renders;
}

/**
 * What a build with no changes did instead, counted.
 *
 * *Every subject matched its baseline, or was settled by a rule you wrote* was
 * the line here, and the `or` is the whole problem: the two halves are different
 * builds — one where the suite is green and one where a ledger is absorbing
 * differences — and the store knows which. A reader who wrote an ignore rule last
 * week and wants to know whether it is still swallowing something was being told
 * the two possibilities they already knew about.
 *
 * Zeroes are dropped rather than printed, because a clean build reads as *41
 * unchanged* and not as a row of noughts to scan past.
 */
function Still({ verdicts }: { readonly verdicts: BuildDetail['verdicts'] }): ReactElement | null {
  const said = [
    verdicts.unchanged === 0 ? undefined : `${number(verdicts.unchanged)} unchanged`,
    verdicts.ignored === 0 ? undefined : `${number(verdicts.ignored)} settled by a rule`,
    verdicts.new === 0 ? undefined : `${count(verdicts.new, 'new subject')}`,
  ].filter((clause): clause is string => clause !== undefined);

  if (said.length === 0) return null;
  return <p className="va-subtitle">{said.join(' · ')}</p>;
}

/** The build against the one before it, in one line, on the page it opens on. */
function Since({ crossing }: { readonly crossing: Crossing }): ReactElement | null {
  if (crossing.state === 'loading') return <p className="va-note">Reading the previous run…</p>;
  if (crossing.state === 'none') {
    return <p className="va-note">There is no earlier run to place this one against.</p>;
  }
  if (crossing.state === 'failed') {
    return (
      <p className="va-failure">
        The previous run could not be read, so nothing here says what has changed since it.{' '}
        {crossing.why}
      </p>
    );
  }

  const { shifts, held } = crossing.divergence;
  const again = shifts.filter((each) => each.shift === 'again').length;
  const first = shifts.filter((each) => each.shift === 'first').length;
  // A subject the earlier run did not have has nothing there to have moved from.
  const fresh = shifts.filter((each) => each.shift === 'new').length;

  const clauses = [
    again === 0
      ? undefined
      : `${count(again, 'subject')} ${again === 1 ? 'carries a difference it' : 'carry a difference they'} already had`,
    first === 0 ? undefined : `${count(first, 'subject')} moved for the first time`,
    fresh === 0
      ? undefined
      : `${count(fresh, 'subject')} ${fresh === 1 ? 'is' : 'are'} new to this run`,
    held === 0 ? undefined : `${count(held, 'subject')} held still in both`,
  ].filter((each): each is string => each !== undefined);

  if (clauses.length === 0) {
    return (
      <p className="va-since">
        Against build {crossing.earlier.build}: nothing here is a difference it also carried, and
        nothing held still in both. Every subject reads some other way than it did.
      </p>
    );
  }

  return (
    <p className="va-since">
      Against build {crossing.earlier.build}: {joined(clauses)}.
      {again === 0 ? '' : ' You have seen those.'}
    </p>
  );
}

/**
 * The clauses as one sentence, in the order they were built.
 *
 * Only the ones with something in them. A count of zero read as *0 moved for the
 * first time* on a run where nothing was new, and a reader has to work out that a
 * number they were shown means the thing did not happen — absent is not zero, and
 * a clause about nothing is a clause worth dropping.
 */
function joined(clauses: readonly string[]): string {
  if (clauses.length === 1) return clauses[0] ?? '';
  return `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1] ?? ''}`;
}
