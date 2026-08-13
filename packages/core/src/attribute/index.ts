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

export { isolateRegions, subtractRegions, excludedBoxes } from './mask.js';
export type {
  ChangeMask,
  DiffRegion,
  ExcludedBox,
  Isolation,
  IsolationOptions,
  Subtraction,
} from './mask.js';

export { attributeRegions, rankRegions } from './region.js';
export type { AttributedRegion, AttributionOptions, RankedRegion } from './region.js';

export { resolveSource, formatSource, indexSource, mergeSourceIndexes } from './source.js';
export type { SourceIndex, SourceRef, Resolution } from './source.js';

export { parseStackFrames, isVendorPath, writerLocationOf } from './stack.js';
export type { StackFrame } from './stack.js';

export {
  parseSourceMap,
  originalPositionFor,
  sourceMappingUrlOf,
  inlineSourceMapOf,
} from './source-map.js';
export type { SourceMap, OriginalPosition } from './source-map.js';

export { createCallSiteResolver, locateProvenance, locateCapture } from './call-site.js';
export type { CallSiteResolver, CallSiteStats, FetchModule } from './call-site.js';

export { hashComponents, causesBetween, movedBands, bandsBetween, UNATTRIBUTED } from './component-hash.js';
export type { BandDigests, ComponentHash } from './component-hash.js';

export { componentInstances, attributed } from './instances.js';
export type { ComponentInstance } from './instances.js';

export { composeSubjects } from './composition.js';
export type {
  Composition,
  ComponentEntry,
  Divergence,
  Echo,
  PropsClass,
  Rendering,
  Site,
  SubjectComposition,
} from './composition.js';

export { attributeMovement } from './movement.js';
export type { Attribution, Cause, Evidence, Moved, Movement } from './movement.js';

export { coverageOf, alsoCovering, summarizeCoverage } from './coverage.js';
export type { Coverage, ComponentCoverage, SubjectCoverage, SubjectValue } from './coverage.js';

export { locateInstability, summarizeInstability } from './instability.js';
export type {
  Instability,
  InstabilityBand,
  UnstableLocation,
  UnstableProperty,
} from './instability.js';
