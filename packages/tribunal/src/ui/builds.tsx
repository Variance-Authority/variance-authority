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
import { Failure, Go, Skeleton, Topbar, messageOf, type Loaded } from './shell.js';
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
          {builds.state === 'loading' ? <Skeleton bars={3} label="Loading builds" /> : null}
          {builds.state === 'failed' ? <Failure why={builds.why} retry={load} /> : null}
          {builds.state === 'ready' ? (
            <BuildList builds={builds.value} go={go} endpoint={client.endpoint} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function BuildList({
  builds,
  go,
  endpoint,
}: {
  readonly builds: readonly BuildSummary[];
  readonly go: (route: Route) => void;
  readonly endpoint?: string | undefined;
}): ReactElement {
  if (builds.length === 0) return <NoBuilds endpoint={endpoint} />;

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
          <CoverageLine build={build} />
        </li>
      ))}
    </ol>
  );
}

/**
 * An empty store, answered with the step that fills it.
 *
 * Every other absence on this surface is a fact about the project — no changes,
 * no findings, nobody's name against a subject — and a sentence is the whole
 * right response to those. This one is a fact about a deployment somebody is
 * still setting up, and they are one command from finishing it. A page that says
 * only *no builds have been posted yet* sends them off to find out where builds
 * come from. It knows, so it says.
 *
 * The address printed is the one this page is talking to, not a placeholder: what
 * a reader copies is their own endpoint, and a deployment cannot hand out an
 * address it is not itself reachable at.
 *
 * Both tokens are named, one of them as the one that must not be here. This is
 * the moment somebody chooses which secret to give a pipeline, and it is the only
 * moment where saying so costs a line.
 */
export function NoBuilds({ endpoint }: { readonly endpoint?: string | undefined }): ReactElement {
  const address = addressOf(endpoint);

  return (
    <div className="va-first">
      <h2>No builds yet</h2>
      <p>
        This store is reachable and holds nothing. A build arrives from <code>variance push</code>,
        which records a run against the endpoint its config names — so point a project at this one:
      </p>
      <pre>
        <code>{`"review": {\n  "endpoint": "${address}",\n  "token": { "env": "VARIANCE_INGEST_TOKEN" }\n}`}</code>
      </pre>
      <p>
        Then, wherever the run happened:
      </p>
      <pre>
        <code>VARIANCE_INGEST_TOKEN=… variance push</code>
      </pre>
      <p className="va-note">
        That is the <strong>ingest</strong> token, the one a pipeline holds. The review token is what
        a person decides a subject with, and recording a build is not a decision.
      </p>
    </div>
  );
}

/**
 * The address to print, preferring what the client was configured with.
 *
 * A relative base is the normal case behind a framework adapter, where the page
 * and the API are one deployment. `variance push` cannot use a relative address,
 * so it is resolved against the page the reader has open. Rendered on a server
 * with no configured endpoint there is no origin to resolve against, and a
 * visible placeholder is better than a wrong URL somebody pastes.
 */
function addressOf(endpoint: string | undefined): string {
  const base = (endpoint ?? '').replace(/\/$/, '');
  if (/^https?:\/\//.test(base)) return base;
  if (typeof window === 'undefined') return 'https://variance.example.com';
  return `${window.location.origin}${base}`;
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
 * How much of the suite this run looked at, and what happened to the rest.
 *
 * **The denominator is the line.** A run that narrowed twenty subjects to two
 * has done the most expensive thinking in the product, and a page reading
 * `2 subjects` reports a suite of two. `2 of 20 observed` is the same fact with
 * the eighteen still in it.
 *
 * The states are not two. A run that stated its coverage and skipped nothing is
 * clean; a run that stated it and failed on fifty is not; and a run that never
 * said is **unknown**, which must not be drawn as the first. That is the collapse
 * `RunReport.notObserved` exists to prevent, and drawing `0 failed` for a silent
 * writer would reintroduce it at the last possible moment.
 *
 * `unreached` is drawn without alarm and without apology. It is not a hole, and
 * it is not somebody's standing decision either — it is the run having read the
 * diff against every stored baseline and concluded the change cannot arrive.
 */
export function CoverageLine({ build }: { readonly build: BuildSummary }): ReactElement {
  const { coverage } = build;
  if (!coverage.stated) {
    return (
      <p className="va-coverage va-unknown">
        This report did not say which subjects it skipped, so its coverage is unknown — not clean.
      </p>
    );
  }

  const seen = Object.values(build.verdicts).reduce((sum, n) => sum + n, 0);
  const planned = seen + coverage.failed + coverage.excluded + coverage.unreached;

  return (
    <p className={coverage.failed > 0 ? 'va-coverage va-incomplete' : 'va-coverage'}>
      <span className="va-num">{seen}</span> of <span className="va-num">{planned}</span> observed
      {coverage.unreached === 0 ? null : (
        <>
          {' · '}
          <span className="va-num">{coverage.unreached}</span> not reached by this change
        </>
      )}
      {coverage.failed === 0 ? null : <> · {coverage.failed} failed to render</>}
      {coverage.excluded === 0 ? null : <> · {coverage.excluded} excluded by configuration</>}
    </p>
  );
}
