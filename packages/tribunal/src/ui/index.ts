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

export { ReviewApp, type ReviewAppProps } from './review.js';
export { BuildList, CoverageLine } from './builds.js';
export { ChangelogEntries, ChangelogPage, ChurnLine, StabilityLine, SubjectHistory } from './history.js';
export { OriginsPanel } from './origins.js';
export { RegionOverlay, RegionTable } from './regions.js';
export { SubjectPanel } from './subject.js';
export { Variations, type Pictures } from './variations.js';
export { Viewer, modesFor, type ViewerMode } from './viewer.js';
export { originsOf, type Appearance, type Origin, type Origins } from './grouping.js';
export {
  hrefOf,
  isPagePath,
  parseRoute,
  type Order,
  type Route,
} from './route.js';
export { DeclarationsPanel } from './declarations.js';
export { ConcernTallyLine, ConcernTrail, Concerns, useConcernTally } from './concerns.js';
export { Settled, needsReview } from './settled.js';
export {
  ReviewRequestError,
  createReviewClient,
  type ReviewClient,
  type ReviewClientOptions,
} from './client.js';
export { REVIEW_STYLES } from './styles.js';
