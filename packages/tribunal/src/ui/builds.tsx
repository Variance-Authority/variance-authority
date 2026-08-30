/**
 * The front page: every build the store has, newest first.
 *
 * A list, and deliberately only a list. What a reader wants here is which build
 * to open, and the two facts that decide it are how many subjects still have
 * nobody's name against them and whether the run observed what it planned to.
 * Everything else about a build is on the build.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { BuildSummary } from '../review-types.js';
import type { ReviewClient } from './client.js';
import type { Route } from './route.js';
import { Failure, Go, Topbar, messageOf, type Loaded } from './shell.js';
import { number, when } from './text.js';

export function BuildsPage({
  client,
  limit,
  go,
}: {
  readonly client: ReviewClient;
  readonly limit?: number | undefined;
  readonly go: (route: Route) => void;
}): ReactElement {
  const [builds, setBuilds] = useState<Loaded<readonly BuildSummary[]>>({ state: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    setBuilds({ state: 'loading' });
    try {
      setBuilds({ state: 'ready', value: await client.builds(limit) });
    } catch (error) {
      // Reported, never rendered as an empty list. "No builds need review" is
      // the sentence somebody merges on.
      setBuilds({ state: 'failed', why: messageOf(error) });
    }
  }, [client, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="va-app">
      <Topbar
        crumbs={[]}
        go={go}
        title="Variance Authority"
        subtitle={builds.state === 'ready' ? (builds.value[0]?.project ?? 'review') : 'review'}
      >
        <nav className="va-nav va-topbar-meta">
          <Go to={{ page: 'changelog' }} go={go} className="va-mode">
            Changelog
          </Go>
        </nav>
      </Topbar>

      <div className="va-body va-scroll">
        <div className="va-page">
          {builds.state === 'loading' ? <p className="va-note">Loading builds…</p> : null}
          {builds.state === 'failed' ? <Failure why={builds.why} retry={load} /> : null}
          {builds.state === 'ready' ? <BuildList builds={builds.value} go={go} /> : null}
        </div>
      </div>
    </div>
  );
}

export function BuildList({
  builds,
  go,
}: {
  readonly builds: readonly BuildSummary[];
  readonly go: (route: Route) => void;
}): ReactElement {
  if (builds.length === 0) return <p className="va-note">No builds have been posted yet.</p>;

  return (
    <ol className="va-builds">
      {builds.map((build) => (
        <li key={build.build} className="va-build">
          <p className="va-build-head">
            <Go to={{ page: 'build', build: build.build }} go={go} className="va-build-open">
              <span className="va-build-id">{build.build}</span>
              <span className="va-build-go">Review →</span>
            </Go>
            <code className="va-commit">{build.commit.slice(0, 8)}</code>
            {build.branch === undefined ? null : <span className="va-branch">{build.branch}</span>}
            <span className="va-when">{when(build.at)}</span>
          </p>
          <Verdicts build={build} />
          <CoverageLine coverage={build.coverage} />
        </li>
      ))}
    </ol>
  );
}

/**
 * The counts, with `pending` given the emphasis.
 *
 * `unchanged` is the large number and the uninteresting one. What decides whether
 * anybody has to open this build is how many subjects still have nobody's name
 * against them.
 *
 * Every verdict the store keeps is named, including `ignored`, which this line
 * used to leave out. Four words over a five-word vocabulary is a line that does
 * not add up to the build it describes — twenty subjects reported as eighteen —
 * and the two it silently dropped are the two that came back green because a
 * declaration said so, which is the half of a build worth auditing.
 */
function Verdicts({ build }: { readonly build: BuildSummary }): ReactElement {
  return (
    <p className="va-verdicts">
      <span className={build.pending > 0 ? 'va-pending' : 'va-settled'}>
        {build.pending > 0 ? `${number(build.pending)} awaiting review` : 'nothing awaiting review'}
      </span>
      <span className="va-counts">
        {build.verdicts.changed} changed · {build.verdicts.new} new ·{' '}
        {build.verdicts.incomparable} incomparable · {build.verdicts.ignored} ignored ·{' '}
        {build.verdicts.unchanged} unchanged
      </span>
    </p>
  );
}

/**
 * What the run said about the subjects it did not observe — including that it
 * said nothing.
 *
 * The three states are not two. A run that stated its coverage and skipped
 * nothing is clean; a run that stated it and failed on fifty is not; and a run
 * that never said is **unknown**, which must not be drawn as the first. That is
 * the collapse `RunReport.notObserved` exists to prevent, and drawing `0 failed`
 * for a silent writer would reintroduce it at the last possible moment.
 */
export function CoverageLine({
  coverage,
}: {
  readonly coverage: BuildSummary['coverage'];
}): ReactElement {
  if (!coverage.stated) {
    return (
      <p className="va-coverage va-unknown">
        This report did not say which subjects it skipped, so its coverage is unknown — not clean.
      </p>
    );
  }
  if (coverage.failed === 0 && coverage.excluded === 0) {
    return <p className="va-coverage">Every planned subject was observed.</p>;
  }
  return (
    <p className={coverage.failed > 0 ? 'va-coverage va-incomplete' : 'va-coverage'}>
      {coverage.failed} failed to render · {coverage.excluded} excluded by configuration
    </p>
  );
}
