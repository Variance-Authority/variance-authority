/**
 * `@variance-authority/observe` — one composition, shipped as an example.
 *
 * The architecture says a pipeline belongs to the caller. This package is where
 * that claim is kept honest: it is the *only* place in the repository where an
 * order is hard-wired, it is named for being one, and it is assembled from the
 * same public tools anybody else would use. Nothing below it imports it.
 *
 * Which is also why it depends on what it does. A composition inherits the
 * requirements of everything it composes — here a PNG codec, because it compares
 * images — and a renderer and a store arrive as arguments, so this package needs
 * neither a browser nor a disk. Swap either and the composition does not notice.
 *
 * What it adds beyond wiring is the part that is genuinely about composition:
 * which verdicts exist, and which of them are allowed to be `unchanged`.
 */

// compass: variance-authority.adjudication

export { observePair, observeAgainstBaseline, observeRasters } from './observe.js';
export { summarizeObservation } from './summarize.js';
export { declaredIgnores } from './decide.js';
export type {
  CompareInputs,
  Observation,
  ObserveOptions,
  RasterVerdict,
  IgnoredPixels,
} from './observe.js';
export { observeCaptureAgainstBaseline } from './capture.js';
export type { ObserveCaptureOptions } from './capture.js';
