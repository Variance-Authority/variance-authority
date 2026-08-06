/**
 * `@variance-authority/raster` — the pixel tier, minus everything that costs.
 *
 * This package needs nothing. No browser, no image codec, no filesystem, no
 * socket. What is left when those are taken away turns out to be most of the
 * interesting part: what a document assembles to, what a renderer promises, what
 * a store promises, which policy a comparison ran under, whether a subject held
 * still at all, and what the composition that produced an answer was.
 *
 * The *tricks* a subject is held still with used to be here and moved to
 * `@variance-authority/core/format` on 2026-08-06. They turned out not to be a
 * pixel-tier concern: an animation in flight moves `transform`, which the cheap
 * representation carries, so the recipe is a render input on every tier and its
 * digest is part of `EnvironmentInputs`.
 *
 * The split is deliberate and it is the point. A team extending their own
 * Playwright tests needs the vocabulary without a second browser; a team storing
 * baselines somewhere this project has never heard of needs the contract without
 * a disk. So the expensive halves are packages of their own, each named for the
 * one thing it requires:
 *
 * | package | requires |
 * |---|---|
 * | `@variance-authority/png` | a PNG codec |
 * | `@variance-authority/playwright` | a browser |
 * | `@variance-authority/store` | a filesystem |
 * | `@variance-authority/remote` | a socket |
 * | `@variance-authority/observe` | the three above it composes |
 *
 * Nothing here imports any of them.
 */

export { assemble, SUBJECT_PATH } from './assemble.js';
export type { AssembleOptions } from './assemble.js';

export { familiesOf, identityAtScale, describeIdentity } from './renderer.js';
export type { Renderer } from './renderer.js';

export { DEFAULT_POLICY, STRICT_POLICY } from './policy.js';
export type { DiffPolicy, RasterComparison, CompareOptions } from './policy.js';

export {
  REFUSAL,
  RasterStoreError,
  createEphemeralStore,
  neverFails,
  identityFrom,
  rasterFrom,
  recordFrom,
  sidecarFrom,
  messageOf,
} from './store.js';
export type { RasterStore, RenderCache, Retention, BaselineKey, Found, Described } from './store.js';

export { settle } from './settle.js';
export type { Settlement } from './settle.js';

export { gateStability, summarizeGate } from './gate.js';
export type { StabilitySample, StabilityVerdict } from './gate.js';

export { DEFAULT_PLAN, DEFAULT_CELL, defaultPlan, defaultPlanIdentity } from './plan.js';
export type { PlanOptions } from './plan.js';
