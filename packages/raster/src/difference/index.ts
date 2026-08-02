/**
 * `@variance-authority/raster/difference` — known-difference measurement.
 *
 * **Requires nothing.** No browser, no image codec, no filesystem, no socket, no
 * clock. Two decoded images in, numbers out. `@variance-authority/png/difference`
 * is the same thing with a PNG decoder attached, and exists only because
 * decoding is the one part that needs somebody's codec.
 *
 * ## What it measures
 *
 * Not "do these two images differ" — that question has a one-bit answer and is
 * already well served. This measures **how the difference between two images has
 * changed since it was last measured**:
 *
 * ```text
 * D₀ = metric(A₀, B₀)      the difference, when it was accepted
 * D₁ = metric(A₁, B₁)      the difference now
 * ΔD = D₁ - D₀             how it moved, per pixel
 * ΔC(t) = C₁(t) - C₀(t)    how it moved, per severity
 * ```
 *
 * That second-order framing is what makes a *known* difference tractable. Two
 * renderers that never agreed, a font stack that was always slightly off, a
 * compression pass that always softened an edge — none of those have to be
 * eliminated before anything can be watched, because the quantity under
 * observation is the disagreement itself rather than either side of it.
 *
 * ## The two axes, kept apart
 *
 * A pixel count collapses *how strongly* and *how much* into one number, and the
 * number is then dominated by area — which is why a one-pixel spacing change can
 * report thousands of differing pixels and mean nothing by it. The curve keeps
 * them separate:
 *
 * ```text
 * C(t) = proportion of the image differing at severity t or above
 * ```
 *
 * so a broad, weak change and a small, severe one stop looking alike.
 *
 * ## What it will not do
 *
 * No verdict, no threshold, no ranking, no grouping, no alignment, no resizing,
 * and no opinion about which severity matters. Those are policy, policy is the
 * caller's, and a library that ships defaults for them has made the most
 * consequential decision in the system somewhere nobody reads. The result type
 * has no status field and there is nowhere to put one.
 *
 * ## Reading it against a threshold you already run
 *
 * `YIQ_DISTANCE` is the arithmetic `pixelmatch` performs, divided by its own
 * maximum — so `severity === threshold²`. A `pixelmatch` or Playwright
 * `toHaveScreenshot` configuration at `threshold: 0.1` is severity `0.01`, and a
 * curve can be quoted against a setting somebody else is already running.
 */

export type {
  AlphaMode,
  DifferenceField,
  FieldStatistics,
  NormalizedImage,
} from './field.js';
export {
  DifferenceFieldError,
  assertComparableImages,
  assertDimensions,
  createField,
  fieldStatistics,
} from './field.js';

export type { DifferenceCurvePoint } from './curve.js';
export { differenceCurve, normalizeSeverityLevels, severityLevelsOf } from './curve.js';

export type { DifferenceMetric, MetricDescriptor } from './metric.js';
export {
  CHANNEL_DISTANCE,
  YIQ_DISTANCE,
  descriptorOf,
  measureChannelDistance,
  measureYiqDistance,
  severityBetweenColors,
  yiqSeverityForThreshold,
  yiqThresholdForSeverity,
} from './metric.js';

export type {
  DifferenceObservation,
  ImageNormalizationOptions,
  NormalizationDescriptor,
  ObserveDifferenceInput,
  Rgb,
} from './observe.js';
export {
  DIFFERENCE_FORMAT_VERSION,
  observeDifference,
  severityLevelsOfObservation,
} from './observe.js';

export type {
  DifferenceComparison,
  DifferenceComparisonSummary,
  DifferenceCurveDelta,
  DifferenceFieldDelta,
  SignedDifferenceField,
} from './compare.js';
export {
  IncomparableObservationsError,
  areComparable,
  comparabilityReasons,
  compareDifferenceObservations,
  curveDelta,
  fieldDelta,
  summarize,
} from './compare.js';

export { DifferenceArtifactError, crc32, deserializeObservation, serializeObservation } from './serialize.js';
