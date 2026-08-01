/**
 * `@variance-authority/core` — the format, the rules, and the verdict model.
 *
 * This package is pure data in, pure data out: no DOM, no React, no I/O, no
 * async. That is enforced by its `tsconfig` (`lib: ES2022` only), so "the core
 * cannot peek at a live document" is a compile error rather than a convention
 * (ADR-0001). Collectors extract; core normalizes and adjudicates.
 */

export type { CanonicalValue } from './canonical.js';
export { canonicalize, canonicalNumber } from './canonical.js';

export type { Digest } from './hash.js';
export { digestString, digestValue, digestCombine } from './hash.js';

export type { ObservationProfile, ProfileId } from './profile.js';
export { JSDOM_PROFILE, CHROMIUM_PROFILE, profileById, observableBands } from './profile.js';

export type {
  EnvironmentInputs,
  EnvironmentKey,
  EnvironmentDelta,
  EnvironmentField,
  Viewport,
} from './environment.js';
export { environmentKey, diffEnvironments } from './environment.js';

export type { Provenance, OwnerFrame, SourceLocation } from './provenance.js';
export { propsDigest } from './provenance.js';

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
} from './snapshot.js';

export type { Verdict, BandOutcome } from './verdict.js';
export { UNOBSERVED, severityOf, worstVerdict, blocks } from './verdict.js';

export type { Band, DeltaKind } from './band.js';
export { BANDS, bandOf } from './band.js';

export {
  RULESET_VERSION,
  ALLOWLIST_VERSION,
  STYLE_ALLOWLIST,
  ATTRIBUTE_ALLOWLIST,
  ID_REFERENCE_ATTRIBUTES,
  ID_REFERENCE_LIST_ATTRIBUTES,
  isAllowedProperty,
  isCustomProperty,
  admits,
  admitsAttribute,
} from './ruleset.js';
