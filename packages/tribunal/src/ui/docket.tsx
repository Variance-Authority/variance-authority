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
import { ConcernTallyLine, useConcernTally } from './concerns.js';
import { useCrossing } from './crossing.js';
import { distanceFrom } from './distance.js';
import { originsOf } from './grouping.js';
import { causeOf } from './lead.js';
import { Opening } from './opening.js';
import { OriginsPanel } from './origins.js';
import { SubjectRail, queueOf } from './rail.js';
import type { Order, Route, Task } from './route.js';
import { RunPage } from './run.js';
import { Siblings } from './same-image.js';
import { needsReview } from './settled.js';
import { Go, Stalled, Topbar, Waiting, messageOf, type Loaded } from './shell.js';
import { SubjectPanel } from './subject.js';
import { Tasks, tasksOf } from './tasks.js';
import { number } from './text.js';

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
  readonly reload: () => Promise<void>;
}): ReactElement {
  const crossing = useCrossing(client, build);
  const concerns = useConcernTally(client, build.build);
  // A decision can open a concern — approving an image an earlier build
  // rejected does — so both reads follow it. The panel holds its buttons until
  // the build is back, since until then it holds the baseline version it read.
  const decided = (): Promise<void> => {
    concerns.refresh();
    return reload();
  };
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
  const tasks = tasksOf(reviewable, build.subjects, concerns.concerns);
  const task = route.page === 'subject' ? route.task : undefined;
  const chosen = task === undefined ? undefined : tasks[task];
  // A task narrows the rail to its renders, and keeps the one on screen in its
  // place until the reviewer moves: deciding it, or resolving its concern, takes
  // it out of the task, and the row under the cursor vanishing would turn *next*
  // into *first*. Still being read, a task lists only that render, so J walks
  // nowhere it might not belong; one that could not be read narrows nothing,
  // since an empty rail would say the task was done.
  // Drawn in the order of the whole build, so a render leaving the task stays
  // where it was rather than joining the end.
  const members = typeof chosen === 'object' ? chosen : chosen === undefined && task !== undefined ? [] : undefined;
  const whole = queueOf(build.subjects);
  const listed =
    members === undefined ? reviewable : whole.filter((each) => each === subject || members.includes(each));
  // The bar walks the queue the rail draws, so *next* is the row below.
  const queue = queueOf(listed);
  const at = subject === undefined ? -1 : queue.indexOf(subject);
  const toSubject = (next: string, within: Task | undefined): Route => ({
    page: 'subject',
    build: build.build,
    subject: next,
    ...(within === undefined ? {} : { task: within }),
  });
  // A render in the chosen task stays on screen; otherwise the task opens on its
  // first render, so choosing a task never leaves the stage on one it does not
  // list.
  const choose = (next: Task | undefined): void => {
    if (next === undefined) {
      go(subject === undefined ? { page: 'build', build: build.build } : toSubject(subject.subject, undefined));
      return;
    }
    const covered = tasks[next];
    if (typeof covered !== 'object') return;
    const kept = subject !== undefined && covered.includes(subject);
    const first = whole.find((each) => covered.includes(each));
    if (kept) go(toSubject(subject.subject, next));
    else if (first !== undefined) go(toSubject(first.subject, next));
  };
  const place = {
    ...(at < 0 ? {} : { at }),
    of: queue.length,
    previous: at > 0 ? queue[at - 1]?.subject : undefined,
    next: queue[at + 1]?.subject,
  };

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
        <ConcernTallyLine tally={concerns.tally} />
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
            <Tasks tasks={tasks} chosen={task} onChoose={choose} />
            <Switch build={build.build} order={order} subjects={reviewable} route={route} go={go} />
            {route.page === 'subject' ? (
              <SubjectRail
                subjects={listed}
                causes={build.causes.length}
                variations={build.variations.length}
                selected={route.subject}
                onSelect={(next) =>
                  go(
                    next === null
                      ? { page: 'build', build: build.build }
                      : toSubject(next, task),
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
              ran={build.at}
              subject={subject}
              siblings={<Siblings client={client} build={build} subject={subject.subject} go={go} />}
              {...(anchor === undefined ? {} : { anchor, far: distanceFrom(build, anchor) })}
              sourced={build.causes.some((cause) => cause.file !== undefined)}
              go={go}
              place={place}
              onGo={(next) => go(toSubject(next, task))}
              onDecided={decided}
              onConcerned={concerns.refresh}
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
              onDecided={decided}
            />
          ) : (
            <Opening
              build={build}
              crossing={crossing}
              missing={route.page === 'change' ? route.change : undefined}
              go={go}
            />
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
          to={route.page === 'subject' ? route : { page: 'subject', build, subject: first }}
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
