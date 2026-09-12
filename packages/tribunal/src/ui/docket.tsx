/**
 * A build: the docket on the left, one thing open beside it.
 *
 * Two panes, and neither of them is the document. The page itself does not
 * scroll — the rail scrolls through the changes, the stage scrolls through the
 * one that is open, and the address says which. That is the difference between a
 * service and a report: a report is a column of everything, read top to bottom
 * once; a service is a place a reviewer navigates, comes back to, sends a link
 * into, and leaves a browser tab on.
 *
 * The four addresses this page answers are four stages behind one rail:
 *
 * - **`/builds/:id`** — the rail with nothing open, and a short reading of the
 *   run beside it. Not the encyclopedia: that is `/run`, and it is a link.
 * - **`/builds/:id/changes/:component`** — one change, whole, with its own
 *   picture and its own two buttons.
 * - **`/builds/:id/subjects/:subject`** — one render, whole, with the rail
 *   switched to subjects.
 * - **`/builds/:id/run`** — everything the run read, full width.
 *
 * The crossing against the previous build is fetched **here**, once, and handed
 * to all four. It is what lets a change card say *build 5 showed you this and
 * nobody decided it* without a second request per card, and it is the reason the
 * run page and a change can never disagree about what the last run said.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { BuildDetail } from '../review-types.js';
import { ChangePanel } from './change.js';
import type { ReviewClient } from './client.js';
import { useCrossing, type Crossing } from './crossing.js';
import { distanceFrom } from './distance.js';
import { Impact } from './impact.js';
import { originsOf } from './grouping.js';
import { causeOf } from './lead.js';
import { OriginsPanel } from './origins.js';
import { SubjectRail } from './rail.js';
import type { Order, Route } from './route.js';
import { RunPage } from './run.js';
import { needsReview } from './settled.js';
import { Go, Stalled, Topbar, Waiting, messageOf, type Loaded } from './shell.js';
import { SubjectPanel } from './subject.js';
import { count, number } from './text.js';

/** The four addresses that live inside one build. */
export type BuildRoute = Extract<Route, { page: 'build' | 'change' | 'subject' | 'run' }>;

export function BuildPage({
  client,
  reviewer,
  route,
  go,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly route: BuildRoute;
  readonly go: (route: Route) => void;
}): ReactElement {
  const [detail, setDetail] = useState<Loaded<BuildDetail>>({ state: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    try {
      setDetail({ state: 'ready', value: await client.build(route.build) });
    } catch (error) {
      setDetail({ state: 'failed', why: messageOf(error) });
    }
  }, [client, route.build]);

  useEffect(() => {
    void load();
  }, [load]);

  // Both states wear the chrome the loaded page wears. The crumb back to the
  // build list is knowable before the build is, and a reader who cannot load a
  // build had no way out of this page without it.
  const crumbs = [{ at: { page: 'builds' } as const, say: 'Builds' }];

  if (detail.state === 'loading') {
    return <Waiting crumbs={crumbs} go={go} title={`Build ${route.build}`} bars={5} />;
  }
  if (detail.state === 'failed') {
    return (
      <Stalled
        crumbs={crumbs}
        go={go}
        title={`Build ${route.build}`}
        why={detail.why}
        retry={load}
      />
    );
  }

  return (
    <Build client={client} reviewer={reviewer} build={detail.value} route={route} go={go} reload={load} />
  );
}

/**
 * The build, once it is loaded — and the level the crossing is asked at.
 *
 * Split from {@link BuildPage} because {@link useCrossing} needs a build to cross
 * and hooks cannot be called behind a loading branch.
 */
function Build({
  client,
  reviewer,
  build,
  route,
  go,
  reload,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly build: BuildDetail;
  readonly route: BuildRoute;
  readonly go: (route: Route) => void;
  readonly reload: () => void;
}): ReactElement {
  const crossing = useCrossing(client, build);
  const order: Order = (route.page === 'build' ? route.order : undefined) ?? 'story';

  const { origins } = originsOf(build);
  const reviewable = build.subjects.filter((subject) => needsReview(subject.verdict));
  const open = route.page === 'change' ? origins.find((each) => each.component === route.change) : undefined;
  const subject =
    route.page === 'subject'
      ? build.subjects.find((each) => each.subject === route.subject)
      : undefined;
  // Anchored on the change this render is filed under: on a page with no single
  // change, distance has nothing to be measured from.
  const anchor = subject === undefined ? undefined : causeOf(subject);

  return (
    <div className="va-app">
      <Topbar
        crumbs={[{ at: { page: 'builds' }, say: 'Builds' }]}
        go={go}
        title={`Build ${build.build}`}
        subtitle={build.project}
      >
        <span className={build.pending > 0 ? 'va-pill va-warn' : 'va-pill va-good'}>
          {build.pending > 0 ? `${number(build.pending)} awaiting review` : 'settled'}
        </span>
        <span className="va-topbar-meta">
          <code className="va-commit">{build.commit.slice(0, 8)}</code>
          {build.branch === undefined ? null : <span>{build.branch}</span>}
          <span>{build.identity.engine}</span>
          <Go to={{ page: 'run', build: build.build }} go={go} className="va-mode">
            The run
          </Go>
        </span>
      </Topbar>

      {route.page === 'run' ? (
        <div className="va-body">
          <RunPage client={client} build={build} crossing={crossing} go={go} />
        </div>
      ) : (
        <div className="va-body">
          <nav className="va-rail">
            <Switch build={build.build} order={order} subjects={reviewable} route={route} go={go} />
            {route.page === 'subject' ? (
              <SubjectRail
                subjects={reviewable}
                causes={build.causes.length}
                variations={build.variations.length}
                selected={route.subject}
                onSelect={(next) =>
                  go(
                    next === null
                      ? { page: 'build', build: build.build }
                      : { page: 'subject', build: build.build, subject: next },
                  )
                }
              />
            ) : (
              <OriginsPanel
                build={build}
                crossing={crossing}
                order={order}
                selected={open?.component}
                go={go}
              />
            )}
          </nav>

          {subject !== undefined ? (
            <SubjectPanel
              client={client}
              reviewer={reviewer}
              build={build.build}
              subject={subject}
              {...(anchor === undefined ? {} : { anchor, far: distanceFrom(build, anchor) })}
              sourced={build.causes.some((cause) => cause.file !== undefined)}
              onDecided={reload}
            />
          ) : open !== undefined ? (
            <ChangePanel
              client={client}
              reviewer={reviewer}
              build={build}
              origin={open}
              crossing={crossing}
              changes={new Set(origins.map((each) => each.component))}
              go={go}
              onDecided={reload}
            />
          ) : (
            <Opening build={build} crossing={crossing} route={route} go={go} />
          )}
        </div>
      )}
    </div>
  );
}

/** Changes or subjects: the two ways to work a build, as two addresses. */
function Switch({
  build,
  order,
  subjects,
  route,
  go,
}: {
  readonly build: string;
  readonly order: Order;
  readonly subjects: readonly { readonly subject: string }[];
  readonly route: BuildRoute;
  readonly go: (route: Route) => void;
}): ReactElement {
  const first = subjects[0]?.subject;

  return (
    <div className="va-switch" role="group" aria-label="What to work through">
      <Go
        to={{ page: 'build', build, order }}
        go={go}
        className={route.page === 'subject' ? 'va-mode' : 'va-mode va-on'}
        title="One row per change: a component and everywhere it moved"
      >
        Changes
      </Go>
      {first === undefined ? (
        <span className="va-mode va-off" title="Nothing in this build is awaiting a decision">
          Subjects
        </span>
      ) : (
        <Go
          to={{ page: 'subject', build, subject: route.page === 'subject' ? route.subject : first }}
          go={go}
          className={route.page === 'subject' ? 'va-mode va-on' : 'va-mode'}
          title="One row per render, which is what the run measured"
        >
          Subjects
        </Go>
      )}
    </div>
  );
}

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
 * expensive line on the page. The heading already counts the changes; the tally,
 * the commits and the diff below are about this build.
 */
function Opening({
  build,
  crossing,
  route,
  go,
}: {
  readonly build: BuildDetail;
  readonly crossing: Crossing;
  readonly route: BuildRoute;
  readonly go: (route: Route) => void;
}): ReactElement {
  const { origins, unattributed } = originsOf(build);
  const missing = route.page === 'change' ? route.change : undefined;

  return (
    <div className="va-stage va-scroll">
      <div className="va-page va-opening">
        {missing === undefined ? null : (
          <p className="va-failure">
            This build has no change under <strong>{missing}</strong>. It may have been decided and
            the baseline promoted, or the link may be from another build.
          </p>
        )}

        <h1>
          {origins.length === 0
            ? 'Nothing in this build changed'
            : `${count(origins.length, 'change')} to work through`}
        </h1>
        {origins.length === 0 ? <Still verdicts={build.verdicts} /> : null}

        {unattributed.length === 0 ? null : (
          <p className="va-note">
            {count(unattributed.length, 'render')} moved with no component named as the cause by a
            region.
          </p>
        )}

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
    verdicts.incomparable === 0 ? undefined : `${count(verdicts.incomparable, 'incomparable')}`,
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
  const fresh = shifts.filter((each) => each.shift === 'new' || each.shift === 'first').length;

  const clauses = [
    again === 0
      ? undefined
      : `${count(again, 'subject')} ${again === 1 ? 'carries a difference it' : 'carry a difference they'} already had`,
    fresh === 0 ? undefined : `${count(fresh, 'subject')} moved for the first time`,
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
