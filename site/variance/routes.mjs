/**
 * The site's subjects: every page its sitemap publishes, read from the build
 * `yarn start` serves.
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
 */

import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  sitemap: 'http://localhost:8787/sitemap.xml',
  source: { dirs: ['app'] },
  // A Mermaid diagram renders after the page loads, and says so with
  // `aria-busy` until it has: a page is ready when nothing on it is busy.
  ready: { '*': 'body:not(:has([aria-busy="true"]))' },
});
