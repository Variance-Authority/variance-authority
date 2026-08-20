/**
 * `@variance-authority/core/format` — what a subject *is*, as a value.
 *
 * The shapes every other group reads and none of them may redefine: a raw
 * capture as a collector hands it over, the normalized snapshot it becomes, the
 * document a renderer paints, the identity that addresses the result, and the
 * hashing that makes any of it comparable.
 *
 * A consumer writing their own collector needs exactly this and nothing else.
 * That is the entrypoint's reason to exist: the format is a contract other people
 * implement, and implementing it should not require reading the rules that
 * interpret it or the verdicts drawn from it.
 */

export type { CanonicalValue } from './canonical.js';
export { canonicalize, canonicalNumber } from './canonical.js';

export type { Digest } from './hash.js';
export { digestString, digestBytes, digestValue, digestCombine } from './hash.js';

export type { ObservationProfile, ProfileId } from './profile.js';
export { JSDOM_PROFILE, CHROMIUM_PROFILE, profileById, tierOfProfile } from './profile.js';

export type { Tier } from './tier.js';
export { tierReaches } from './tier.js';

export type {
  EnvironmentInputs,
  EnvironmentKey,
  EnvironmentDelta,
  EnvironmentField,
  Viewport,
} from './environment.js';
export { environmentKey, diffEnvironments } from './environment.js';

export {
  INTERVENTIONS,
  SEMANTIC_RECIPE,
  COLLECT_RECIPE,
  LAYOUT_RECIPE,
  RASTER_RECIPE,
  holdAnimations,
  pinAnimations,
  hideCaret,
  hideScrollbars,
  hidePresentationalImages,
  waitForFonts,
  waitForImages,
  forTier,
  conflicts,
  interventionById,
  recipeOf,
  recipeCss,
  recipeScreenshot,
  recipeDigest,
  settleRecipe,
  describeRecipe,
} from './stabilize.js';
export type {
  Intervention,
  Recipe,
  Trick,
  ScreenshotOptions,
  SettleTarget,
} from './stabilize.js';

export type { Provenance, OwnerFrame, SourceLocation, StackFrame } from './provenance.js';
export { propsDigest, jsxSourceOf, relativizeSource, JSX_SOURCE } from './provenance.js';
export type { Wiring } from './wiring.js';
export { keyedByPosition } from './wiring.js';

export type {
  RawCapture,
  RawNode,
  RawAria,
  MatchedRule,
  Declaration,
  Rect,
  SubjectRef,
  Diagnostic,
} from './capture.js';

export type {
  SemanticSnapshot,
  SemanticNode,
  NodePath,
  StyleProvenanceEntry,
  IgnoreSite,
  ComponentHash,
} from './snapshot.js';

export { documentDigest, identityDigest } from './document.js';
export type {
  RenderDocument,
  RenderFrame,
  FrameElement,
  RenderResource,
  RenderIdentity,
  Raster,
} from './document.js';
