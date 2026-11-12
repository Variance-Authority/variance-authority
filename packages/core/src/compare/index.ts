/**
 * `@variance-authority/core/compare` — two snapshots become a list of deltas.
 *
 * Tree matching, the delta vocabulary, the bands a delta falls into, and what a
 * changed property is capable of doing to a layout. No verdict: this group says
 * *what moved*, and refuses to say whether anyone should mind.
 *
 * The split from `judge` is the load-bearing one. A comparison that also decided
 * severity could not be reused by a caller with a different policy, and every
 * team has a different policy.
 */

export { diffSnapshots, matchTrees } from './diff/index.js';
export type {
  SemanticDiff,
  Delta,
  Root,
  RootKind,
  ChangedComponent,
  Matching,
} from './diff/index.js';

export { impactOf, canReflow, aggregateImpact } from './impact.js';
export type { PropertyImpact, AggregateImpact } from './impact.js';

export type { Band, DeltaKind } from './band.js';
export { BANDS, bandOf, loudestBand } from './band.js';

export {
  observableBands,
  decidesBand,
  weaker,
  sharedObservability,
  unobservedBands,
  narrowedBands,
} from './observability.js';
export type { Observability } from './observability.js';

export { deriveVariation } from './derive.js';
export type { Variation } from './derive.js';

export { partingOf } from './parting.js';
export { boundarySnapshot } from './instance.js';
export { sliceOf, sameTree } from './slice.js';
export type { PartingSlice } from './slice.js';
export type {
  Parting,
  PartedBoundary,
  PartingRung,
  PartingPlace,
  MovedInput,
} from './parting.js';

export { explainParting } from './explain.js';

export { compareValues, fingerprintOfValueDelta } from './value.js';
export type { ValueChange, ValueDelta } from './value.js';
