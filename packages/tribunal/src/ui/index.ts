/**
 * The review surface: React components, a JSON client, and a stylesheet as text.
 *
 * Requires React, and nothing else — no router, no data library, no CSS
 * toolchain. Separate from every other entrypoint so that a Worker serving
 * baselines does not pull React into its bundle to do it.
 *
 * The addresses are part of the surface. {@link ReviewApp} routes itself against
 * `location` when it is left alone, which is what the Node service wants; a host
 * with a router of its own passes `route` and `onNavigate` and keeps the URL,
 * and {@link parseRoute}, {@link hrefOf} and {@link isPagePath} are the three
 * functions that takes. The last one is why a link that renders is a link that
 * serves: the host answers exactly the paths this surface will ever produce.
 */

export {
  BuildList,
  ChangelogEntries,
  ChangelogPage,
  ChurnLine,
  CoverageLine,
  OriginsPanel,
  RegionOverlay,
  RegionTable,
  ReviewApp,
  StabilityLine,
  SubjectHistory,
  SubjectPanel,
  Variations,
  Viewer,
  modesFor,
  originsOf,
  type Appearance,
  type Origin,
  type Origins,
  type ReviewAppProps,
  type ViewerMode,
} from './review.js';
export {
  hrefOf,
  isPagePath,
  parseRoute,
  type Order,
  type Route,
} from './route.js';
export { DeclarationsPanel } from './declarations.js';
export { Settled, needsReview } from './settled.js';
export {
  ReviewRequestError,
  createReviewClient,
  type ReviewClient,
  type ReviewClientOptions,
} from './client.js';
export { REVIEW_STYLES } from './styles.js';
