/**
 * `@variance-authority/raster` — the pixel tier, as separate phases.
 *
 * The order is the pipeline, and each step is a module because each one fails
 * differently and has to be testable on its own:
 *
 * | phase | in | out | needs |
 * |---|---|---|---|
 * | acquire | live DOM | `RenderDocument` | a DOM (`collector-dom`) |
 * | assemble | `RenderDocument` | HTML | nothing |
 * | render | HTML | `Raster` | a browser, here or elsewhere |
 * | compare | two `Raster` | `ChangeMask` | PNG decoding |
 * | isolate | `ChangeMask` | regions | nothing (`core`) |
 * | attribute | regions + snapshot | components | nothing (`core`) |
 *
 * Two of the six need a browser and two of them need nothing at all, which is
 * the property that matters: the steps that decide *what a change means* are
 * pure functions over plain data, and can be exercised without rendering
 * anything.
 */

export { assemble, SUBJECT_PATH } from './assemble.js';
export type { AssembleOptions } from './assemble.js';

export { familiesOf } from './renderer.js';
export type { Renderer } from './renderer.js';

export { createPlaywrightRenderer } from './render-playwright.js';
export type { PlaywrightRendererOptions } from './render-playwright.js';

export { connectRenderer, serveRenderer, RENDER_PATH, IDENTITY_PATH } from './render-remote.js';
export type { RemoteRendererOptions, RenderServer } from './render-remote.js';

export {
  compareRasters,
  comparePngs,
  diffImage,
  decode,
  DEFAULT_POLICY,
  STRICT_POLICY,
} from './compare.js';
export type { DiffPolicy, RasterComparison, CompareOptions } from './compare.js';

export { createEphemeralStore, createDurableStore, renderCached } from './store.js';
export type { RasterStore, Retention, BaselineKey, Found } from './store.js';

export { createLfsStore } from './store-lfs.js';
export type { LfsStore, LfsStoreOptions, LfsTracking, CommandRunner, CommandResult } from './store-lfs.js';

export {
  createRemoteStore,
  serveRasterStore,
  RasterStoreError,
  BASELINE_FIND_PATH,
  BASELINE_PUT_PATH,
  CACHE_FIND_PATH,
  CACHE_PUT_PATH,
} from './store-remote.js';
export type { RemoteStoreOptions, ServeStoreOptions, StoreServer } from './store-remote.js';

export { observePair, observeAgainstBaseline, summarizeObservation } from './observe.js';
export type { Observation, ObserveOptions, RasterVerdict } from './observe.js';
