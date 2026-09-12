/**
 * The run, in full — everything the report says that is not one change.
 *
 * This is the material that used to sit under the docket on the build page, and
 * moving it is the whole of the layout argument. Reach, the crossing against the
 * last run, the variation lattice, what a declaration settled, what was declared,
 * what was never observed: every one of those is worth reading, and none of them
 * is worth reading *while deciding whether to approve a restyle of `Button`*. On
 * one page they were four thousand pixels of scroll between a reviewer and the
 * second change in the build.
 *
 * So they have an address. A reviewer working a docket never opens it; a reviewer
 * asking *what did this run actually do* opens nothing else. The crossing is
 * handed down rather than fetched again — the build page has already asked, and
 * the two readings of one comparison must not be able to disagree.
 */

import type { ReactElement } from 'react';
import type { BuildDetail } from '../review-types.js';
import type { ReviewClient } from './client.js';
import type { Crossing } from './crossing.js';
import type { Route } from './route.js';
import { DeclarationsPanel } from './declarations.js';
import { DivergenceOf } from './divergence.js';
import { JourneysPanel } from './journeys.js';
import { ReachPanel } from './reach.js';
import { Settled } from './settled.js';
import { Prose } from './shell.js';
import { CoverageLine } from './builds.js';
import { Variations } from './variations.js';

export function RunPage({
  client,
  build,
  crossing,
  go,
}: {
  readonly client: ReviewClient;
  readonly build: BuildDetail;
  readonly crossing: Crossing;
  /**
   * Taken rather than read from the address, because a host router may own it.
   *
   * The only thing on this page that navigates is the settled panel's link into
   * an absorbed subject, and a page that reached for `location` to render it
   * would work in the Node service and push a second entry onto a Next app's
   * history stack.
   */
  readonly go: (route: Route) => void;
}): ReactElement {
  return (
    <div className="va-stage va-scroll">
      <div className="va-page">
        <h1>What this run read</h1>
        <p className="va-subtitle">
          The whole reading, in the order it was made: what the commit reaches, what has changed
          since the last run, what was compared without a baseline, and what nothing looked at. The
          decisions are on the changes.
        </p>

        {build.intent === undefined ? null : (
          <p className="va-intent">
            Declared intent: <em>{build.intent}</em>
          </p>
        )}
        <CoverageLine build={build} />

        <section className="va-card">
          <ReachPanel client={client} build={build} />
        </section>

        {build.journeys === null ? null : (
          <section className="va-card">
            <JourneysPanel build={build} />
          </section>
        )}

        <section className="va-card">
          <DivergenceOf crossing={crossing} />
        </section>

        {build.variations.length === 0 ? null : (
          <section className="va-card">
            <Variations variations={build.variations} />
          </section>
        )}

        <section className="va-card">
          <h2>Settled</h2>
          <Settled
            subjects={build.subjects}
            ignores={build.declarations.ignores}
            build={build.build}
            go={go}
          />
        </section>

        <section className="va-card">
          <h2>Declarations</h2>
          <DeclarationsPanel declarations={build.declarations} />
        </section>

        {build.notObserved.length === 0 ? null : (
          <section className="va-card">
            <h2>Not observed</h2>
            <ul className="va-not-observed">
              {build.notObserved.map((entry) => (
                <li key={entry.subject} className={entry.kind === 'failed' ? 'va-failed' : ''}>
                  <strong>{entry.subject}</strong> — <Prose text={entry.because} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
