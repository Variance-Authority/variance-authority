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

export { diffSnapshots, matchTrees, deltaSignature } from './diff/index.js';
export type {
  SemanticDiff,
  Delta,
  Root,
  RootKind,
  ChangedComponent,
  Matching,
} from './diff/index.js';

export { locate } from './locate.js';
export type { Location, LocationStep } from './locate.js';

export { documentDigest, identityDigest } from './document.js';
export type {
  RenderDocument,
  RenderFrame,
  FrameElement,
  RenderIdentity,
  Raster,
} from './document.js';

export { hashComponents, UNATTRIBUTED } from './component-hash.js';
export { coverageOf, alsoCovering, summarizeCoverage } from './coverage.js';
export { locateInstability, summarizeInstability } from './instability.js';
export { planIdentity, validatePlan, planForTier, describePlan } from './tool.js';
export type { ToolKind, Tier, IdentityContribution, ToolDeclaration, Plan, PlanProblem } from './tool.js';
export type { Instability, InstabilityBand, UnstableLocation, UnstableProperty } from './instability.js';
export type { Coverage, ComponentCoverage, SubjectCoverage, SubjectValue } from './coverage.js';
export type { ComponentHash } from './component-hash.js';
export { isolateRegions, attributeRegions, rankRegions } from './region.js';
export type {
  ChangeMask,
  DiffRegion,
  Isolation,
  IsolationOptions,
  AttributedRegion,
  AttributionOptions,
  RankedRegion,
} from './region.js';

export { resolveSource, formatSource, indexSource, mergeSourceIndexes } from './source.js';
export type { SourceIndex, SourceRef, Resolution } from './source.js';

export { adjudicate, summarizeAdjudication } from './intent.js';
export type { Intent, IntentClaim, Policy, Adjudication, Adjudicated } from './intent.js';

export { buildDocket, summarize } from './docket.js';
export type { Docket, DocketEntry, DocketOptions } from './docket.js';

export { impactOf, canReflow, aggregateImpact } from './impact.js';
export type { PropertyImpact, AggregateImpact } from './impact.js';

export type { Band, DeltaKind } from './band.js';
export { BANDS, bandOf } from './band.js';

export { normalize } from './normalize/index.js';
export type { NormalizeOptions } from './normalize/index.js';
export type { AliasMap, AliasResult, InheritContext, ResolvedStyle, DeclarationOrigin } from './normalize/index.js';
export {
  buildAliasMap,
  aliasAttributeValue,
  aliasStyleValue,
  resolveStyle,
  resolveVariables,
  INHERITED_PROPERTIES,
  EMPTY_CONTEXT,
  canonicalizeValue,
  canonicalizeTokens,
  canonicalizeDimension,
  isUnresolved,
  canonicalizeColor,
  parseColor,
  formatColor,
  expandDeclaration,
  isShorthand,
  SHORTHAND_PROPERTIES,
} from './normalize/index.js';

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
