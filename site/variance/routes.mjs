/**
 * The site's subjects: every page its sitemap publishes that does not exclude
 * itself, read from the build `yarn start` serves. A markdown page excludes
 * itself — `MarkdownDocument` carries `data-variance-exclude` — so what is
 * photographed is the catalog and component pages, and a page added to either
 * side lands there with no edit here.
 *
 * The sitemap names `https://variance-authority.dev`, because that is where the
 * site is published; the collector visits each page on the server it read the
 * sitemap from, so this photographs the build and not production. A page added
 * to the navigation is watched without an edit here, and a page removed is named
 * by the run as a baseline its plan no longer holds.
 *
 * The page is the subject, header and footer included: they are the site's too,
 * and a change to them is one cause across every page rather than a change
 * nobody photographed.
 *
 * A build made with `VARIANCE_AUTHORITY_PROBES` set says which page ran what,
 * on the server too; a run with it set records each page's execution, and the
 * files its body says it showed, for the `site` suite's next selection.
 */

import { routeCollector } from '@variance-authority/route-collector';

const recorded = process.env.VARIANCE_AUTHORITY_PROBES !== undefined;

export default routeCollector({
  sitemap: 'http://localhost:8787/sitemap.xml',
  // A component's file is named from the checkout's root, where the run starts.
  source: { dirs: ['site/app'] },
  // A Mermaid diagram renders after the page loads, and says so with
  // `aria-busy` until it has: a page is ready when nothing on it is busy.
  ready: { '*': 'body:not(:has([aria-busy="true"]))' },
  ...(recorded ? { tests: { suite: 'site', heads: ['site'] } } : {}),
});
