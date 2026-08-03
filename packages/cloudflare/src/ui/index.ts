/**
 * The review surface: React components, a JSON client, and a stylesheet as text.
 *
 * Requires React, and nothing else — no router, no data library, no CSS
 * toolchain. Separate from every other entrypoint so that a Worker serving
 * baselines does not pull React into its bundle to do it.
 */

export {
  BuildList,
  CoverageLine,
  Docket,
  RegionOverlay,
  ReviewApp,
  SubjectPanel,
  Viewer,
  modesFor,
  type ReviewAppProps,
  type ViewerMode,
} from './review.js';
export {
  ReviewRequestError,
  createReviewClient,
  type ReviewClient,
  type ReviewClientOptions,
} from './client.js';
export { REVIEW_STYLES } from './styles.js';
