/**
 * Comparing two observations — how the difference itself moved.
 *
 * This is the operation the whole package exists for, and it is second-order:
 * not "how do these two images differ" but "how has the difference between two
 * images changed since it was last measured". That distinction is what makes a
 * *known* difference workable. Two renderers that never agreed can be tracked
 * without pretending they should agree, because the quantity under observation is
 * the disagreement, not either side of it.
 *
 * Two outputs, and they answer different questions:
 *
 * - the **curve delta** says how much more (or less) of the image differs at each
 *   severity — a small, portable, graphable summary;
 * - the **field delta** says where, at full spatial resolution, for whatever
 *   downstream wants to cluster, attribute or draw it.
 *
 * Neither says whether the change is acceptable. There is no status field, and
 * adding one is the one change that would make this package unfit for the callers
 * that disagree about policy — which is all of them.
 */

import type { DifferenceCurvePoint } from './curve.js';
import { createField, type DifferenceField } from './field.js';
import type { DifferenceObservation } from './observe.js';

export class IncomparableObservationsError extends Error {
  override readonly name = 'IncomparableObservationsError';
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(
      `observations are not comparable:\n  - ${reasons.join('\n  - ')}\n` +
        'A number taken under a different configuration is a different number. Re-observe the ' +
        'baseline pair under the current configuration rather than comparing across this.',
    );
    this.reasons = reasons;
  }
}

export interface DifferenceCurveDelta {
  readonly severity: number;
  readonly baselinePixelCount: number;
  readonly currentPixelCount: number;
  readonly pixelCountDelta: number;
  readonly baselineImageRatio: number;
  readonly currentImageRatio: number;
  readonly imageRatioDelta: number;
}

/**
 * A field of *changes* in difference, so its values may be negative.
 *
 * Separate from `DifferenceField` on purpose. A difference is a magnitude and
 * cannot be below zero; a change in one obviously can, and giving both the same
 * type would mean either dropping that invariant everywhere or breaking it here.
 */
export interface SignedDifferenceField {
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array;
}

export interface DifferenceFieldDelta {
  readonly signed: SignedDifferenceField;
  readonly increase: DifferenceField;
  readonly decrease: DifferenceField;
}

export interface DifferenceComparisonSummary {
  readonly baselineMean: number;
  readonly currentMean: number;
  readonly meanDelta: number;
  readonly baselineMaximum: number;
  readonly currentMaximum: number;
  readonly maximumDelta: number;
  readonly totalIncrease: number;
  readonly totalDecrease: number;
}

export interface DifferenceComparison {
  readonly baseline: DifferenceObservation;
  readonly current: DifferenceObservation;
  readonly curveDelta: readonly DifferenceCurveDelta[];
  readonly fieldDelta: DifferenceFieldDelta;
  readonly summary: DifferenceComparisonSummary;
}

/**
 * Every way two observations can fail to be about the same measurement.
 *
 * Returned rather than thrown so a caller can report all of them at once, and so
 * a caller who only wants the curve can ask whether a comparison would be sound
 * before paying for the fields.
 *
 * Three of these are not in the original specification and are checked anyway,
 * because each one silently changes what a severity number means:
 * `formatVersion` (the shape the numbers were written in), the metric's `unit`
 * (two metrics can both run 0 to 1 and mean different things), and the
 * normalisation `parameters` (flattening onto white and onto black produce
 * different pixels under an identical version string).
 */
export function comparabilityReasons(
  baseline: DifferenceObservation,
  current: DifferenceObservation,
): readonly string[] {
  const reasons: string[] = [];

  const mismatch = (what: string, left: unknown, right: unknown): void => {
    if (!deepEqual(left, right)) {
      reasons.push(`${what}: baseline ${describe(left)}, current ${describe(right)}`);
    }
  };

  mismatch('format version', baseline.formatVersion, current.formatVersion);
  mismatch('metric name', baseline.metric.name, current.metric.name);
  mismatch('metric version', baseline.metric.version, current.metric.version);
  mismatch('metric parameters', baseline.metric.parameters, current.metric.parameters);
  mismatch('metric unit', baseline.metric.unit, current.metric.unit);
  mismatch('normalization version', baseline.normalization.version, current.normalization.version);
  mismatch(
    'normalization parameters',
    baseline.normalization.parameters,
    current.normalization.parameters,
  );
  mismatch('colour space', baseline.image.colorSpace, current.image.colorSpace);
  mismatch('alpha mode', baseline.image.alphaMode, current.image.alphaMode);

  if (baseline.image.width !== current.image.width || baseline.image.height !== current.image.height) {
    reasons.push(
      `image dimensions: baseline ${baseline.image.width}×${baseline.image.height}, ` +
        `current ${current.image.width}×${current.image.height}`,
    );
  }

  const baselineLevels = baseline.curve.map((point) => point.severity);
  const currentLevels = current.curve.map((point) => point.severity);
  if (!deepEqual(baselineLevels, currentLevels)) {
    reasons.push(
      `severity levels: baseline [${baselineLevels.join(', ')}], current [${currentLevels.join(', ')}]`,
    );
  }

  return reasons;
}

/** `true` when {@link compareDifferenceObservations} would not throw. */
export function areComparable(
  baseline: DifferenceObservation,
  current: DifferenceObservation,
): boolean {
  return comparabilityReasons(baseline, current).length === 0;
}

export function compareDifferenceObservations(
  baseline: DifferenceObservation,
  current: DifferenceObservation,
): DifferenceComparison {
  const reasons = comparabilityReasons(baseline, current);
  if (reasons.length > 0) throw new IncomparableObservationsError(reasons);

  return {
    baseline,
    current,
    curveDelta: curveDelta(baseline.curve, current.curve),
    fieldDelta: fieldDelta(baseline.field, current.field),
    summary: summarize(baseline.field, current.field),
  };
}

export function curveDelta(
  baseline: readonly DifferenceCurvePoint[],
  current: readonly DifferenceCurvePoint[],
): readonly DifferenceCurveDelta[] {
  return baseline.map((point, index) => {
    const now = current[index]!;
    return {
      severity: point.severity,
      baselinePixelCount: point.pixelCount,
      currentPixelCount: now.pixelCount,
      pixelCountDelta: now.pixelCount - point.pixelCount,
      baselineImageRatio: point.imageRatio,
      currentImageRatio: now.imageRatio,
      imageRatioDelta: now.imageRatio - point.imageRatio,
    };
  });
}

export function fieldDelta(
  baseline: DifferenceField,
  current: DifferenceField,
): DifferenceFieldDelta {
  const { width, height } = current;
  const count = width * height;

  const signed = new Float32Array(count);
  const increase = new Float32Array(count);
  const decrease = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    const delta = current.values[index]! - baseline.values[index]!;
    signed[index] = delta;
    if (delta > 0) increase[index] = delta;
    else decrease[index] = -delta;
  }

  return {
    signed: { width, height, values: signed },
    increase: createField(width, height, increase),
    decrease: createField(width, height, decrease),
  };
}

/**
 * The secondary summaries.
 *
 * Kept because they are cheap and sometimes all a caller wants, and kept
 * *secondary* because each one throws away the distribution that made the curve
 * worth having. `mean` in particular is dominated by the pixels that did not
 * change: on a typical interface diff almost every pixel is zero, so a real,
 * severe, local change moves the mean by an amount indistinguishable from noise.
 * Read the curve; quote the mean only alongside it.
 *
 * `totalIncrease` and `totalDecrease` are sums over the image, so they scale with
 * area and are not comparable between subjects of different sizes.
 */
export function summarize(
  baseline: DifferenceField,
  current: DifferenceField,
): DifferenceComparisonSummary {
  let baselineSum = 0;
  let currentSum = 0;
  let baselineMaximum = 0;
  let currentMaximum = 0;
  let totalIncrease = 0;
  let totalDecrease = 0;

  const count = current.values.length;
  for (let index = 0; index < count; index += 1) {
    const before = baseline.values[index]!;
    const after = current.values[index]!;

    baselineSum += before;
    currentSum += after;
    if (before > baselineMaximum) baselineMaximum = before;
    if (after > currentMaximum) currentMaximum = after;

    const delta = after - before;
    if (delta > 0) totalIncrease += delta;
    else totalDecrease -= delta;
  }

  const baselineMean = count === 0 ? 0 : baselineSum / count;
  const currentMean = count === 0 ? 0 : currentSum / count;

  return {
    baselineMean,
    currentMean,
    meanDelta: currentMean - baselineMean,
    baselineMaximum,
    currentMaximum,
    maximumDelta: currentMaximum - baselineMaximum,
    totalIncrease,
    totalDecrease,
  };
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }

  const leftKeys = Object.keys(left as Record<string, unknown>).sort();
  const rightKeys = Object.keys(right as Record<string, unknown>).sort();
  if (!deepEqual(leftKeys, rightKeys)) return false;

  return leftKeys.every((key) =>
    deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}

function describe(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}
