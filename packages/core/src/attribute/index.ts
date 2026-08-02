/**
 * `@variance-authority/core/attribute` — from a position to a name to a file.
 *
 * The group that makes a difference actionable. Pixels cluster into regions,
 * regions join the box tree, the tree knows which component produced each node,
 * and the component resolves to a source location. The same machinery answers
 * "which component is not holding still" and "which subjects cover this
 * component".
 *
 * This is the answer to *"a pixel differ reports 1530 pixels changed"* — and the
 * reason it is a group rather than a function is that every step of the journey
 * is separately useful, and separately capable of refusing. `locateInstability`
 * will not name a component for a difference that is beneath the semantic tier;
 * `coverage` will not recommend deleting anything.
 */

export { locate } from './locate.js';
export type { Location, LocationStep } from './locate.js';

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

export { hashComponents, UNATTRIBUTED } from './component-hash.js';
export type { ComponentHash } from './component-hash.js';

export { coverageOf, alsoCovering, summarizeCoverage } from './coverage.js';
export type { Coverage, ComponentCoverage, SubjectCoverage, SubjectValue } from './coverage.js';

export { locateInstability, summarizeInstability } from './instability.js';
export type {
  Instability,
  InstabilityBand,
  UnstableLocation,
  UnstableProperty,
} from './instability.js';
