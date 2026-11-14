/**
 * The review surface, as ordinary React.
 *
 * No framework imports, no router, no data-fetching library, no CSS toolchain —
 * so it mounts inside whatever the operator already deploys. `./next` is one
 * such wiring, for a [vinext](https://vinext.io) app; a Vite SPA needs nothing
 * from this package but these components and `createReviewClient`.
 *
 * ## What this surface is *for*, which is not "looking at two screenshots"
 *
 * Every hosted product in this category shows you a before and an after and asks
 * you to spot the difference. That is the review blindness the whole project
 * exists to refuse: the hundredth screenshot in a run gets the same glance as the
 * first, and the three-hundred-and-first is approved without being read.
 *
 * So the ordering here is deliberate and is the opposite of the category's:
 *
 * 1. **The docket first**, and it is where a build opens — components named as
 *    *causes*, banded by what it costs to be wrong about them. One token change
 *    across 300 subjects is one item with a count.
 * 2. **The regions on the image.** A reviewer sees which box moved and which
 *    component owns it, drawn over the render, cause and collateral distinct.
 * 3. **The image last**, and only then as a comparison.
 *
 * Ranked by area a report of this kind is *wrong* — a container that was never
 * edited and only reflowed outranks the edit, measured at 6× on one change. The
 * ordering below comes from the tier that has provenance, which is why `cause`
 * is a field on a region rather than a guess made here.
 *
 * ## Seven addresses, because this is a service and not a report
 *
 * This file is the router and nothing else. Every page is its own module and its
 * own URL: [`builds.tsx`](./builds.tsx), [`docket.tsx`](./docket.tsx) for a build
 * and the three stages inside it, [`change.tsx`](./change.tsx),
 * [`subject.tsx`](./subject.tsx), [`run.tsx`](./run.tsx),
 * [`history.tsx`](./history.tsx).
 *
 * The version this replaced held all of that in one component and three pieces of
 * `useState`, which made every reading of a build the same address. A reviewer
 * could not link a colleague to a change, could not open two in tabs, could not
 * come back to one, and could not use the back button — and because there was one
 * page, everything the run had to say was stacked on it. The build page reached
 * twenty-seven thousand pixels, the divergence panel sat below four thousand of
 * them, and the surface's best finding was in the part nobody scrolled to.
 * [`route.ts`](./route.ts) is the address table both this and the Node service
 * read, so a link that renders is a link that serves.
 *
 * ## And then the record, because "is this normal?" is the real question
 *
 * A difference is not a decision. The same 2px shift is a bug in a component
 * nobody has touched since March and a Tuesday in one that moves in nineteen runs
 * out of twenty, and a before-and-after cannot tell those apart. So the surface
 * reaches the same history the CLI writes — churn, reach, stability, and the
 * changelog of what was approved before — one subject at a time, and beside the
 * change it is about rather than in a panel of its own.
 */

import type { ReactElement } from 'react';
import type { ReviewClient } from './client.js';
import { BuildsPage } from './builds.js';
import { BuildPage } from './docket.js';
import { ChangelogPage } from './history.js';
import { useRoute } from './navigation.js';
import { Reading, SignIn } from './reading.js';
import { hrefOf, type Route } from './route.js';
import { Nowhere } from './shell.js';

export interface ReviewAppProps {
  readonly client: ReviewClient;
  /**
   * Who decides here, as the deployment recognized them. Absent is somebody it
   * lets read: the surface shows the evidence and offers no move that writes.
   */
  readonly reviewer?: string | undefined;
  /** Where a reader signs in, for a deployment that has a sign-in. They return to the page they have reached. */
  readonly signIn?: string | undefined;
  /** How many builds to list. The server's own default applies when absent. */
  readonly limit?: number;
  /**
   * The address, when the host owns one.
   *
   * A Next app renders this inside a router that already holds the URL, and two
   * things writing to one history stack is a back button that goes sideways.
   * Given both of these, the surface reads the host's route and calls the host's
   * navigate; given neither, it uses `pushState` itself.
   */
  readonly route?: Route | undefined;
  readonly onNavigate?: ((route: Route) => void) | undefined;
}

/**
 * The whole surface, mounted at whatever address it finds itself at.
 *
 * Give it a client and the reviewer's name and it is the entire review
 * experience: builds awaiting decision, changes banded by what it costs to be
 * wrong about them, regions drawn, and the approve and reject that write back. It
 * holds no credential of its own, which is why the name is a prop and not
 * something it asks the server for.
 */
export function ReviewApp({
  client,
  reviewer,
  signIn,
  limit,
  route,
  onNavigate,
}: ReviewAppProps): ReactElement {
  const [here, go] = useRoute(route, onNavigate);

  // An address nobody claims is a rotted link, and rendering the front page for
  // it would tell the reader their link worked.
  if (here === undefined) return <Nowhere go={go} />;

  const entry = signIn === undefined ? undefined : `${signIn}?return=${encodeURIComponent(hrefOf(here))}`;

  if (here.page === 'builds') {
    return (
      <SignIn.Provider value={entry}>
        <BuildsPage client={client} limit={limit} go={go} />
      </SignIn.Provider>
    );
  }

  if (here.page === 'changelog') {
    return (
      <div className="va-app">
        <ChangelogPage client={client} onBack={() => go({ page: 'builds' })} />
      </div>
    );
  }

  return (
    <SignIn.Provider value={entry}>
      <Reading.Provider value={reviewer === undefined}>
        <BuildPage client={client} reviewer={reviewer ?? ''} route={here} go={go} />
      </Reading.Provider>
    </SignIn.Provider>
  );
}
