/**
 * The difference curve — severity against amount.
 *
 * ```text
 * C(t) = |{ (x, y) : D(x, y) >= t }| / N
 * ```
 *
 * One number cannot say both *how strongly* an image differs and *how much of it*
 * does, which is why "5482 pixels changed" is unactionable: it is an area, and an
 * area is dominated by whatever sits below the edit. The curve keeps the two axes
 * apart. A recolour is a large area at one severity; a broken control is a small
 * area at a high one; antialiasing is a large area at almost none. All three
 * produce comparable pixel counts and completely different curves.
 *
 * The caller supplies the severity levels. This is not politeness — a level is a
 * policy, policies belong to whoever has to live with the verdict, and a library
 * that ships "sensible thresholds" has made the most consequential decision in
 * the system and hidden it in a default.
 */

import type { DifferenceField } from './field.js';
import { DifferenceFieldError } from './field.js';

export interface DifferenceCurvePoint {
  readonly severity: number;
  readonly pixelCount: number;
  readonly imageRatio: number;
}

/**
 * Validate, sort ascending and de-duplicate.
 *
 * Sorted because a curve is monotonically non-increasing in `t` and an unsorted
 * one invites a reader to see a rise that is not there. De-duplicated because two
 * identical levels are two identical points, and the second is noise in every
 * downstream diff, delta and serialization.
 */
export function normalizeSeverityLevels(levels: readonly number[]): readonly number[] {
  for (const level of levels) {
    if (!Number.isFinite(level) || level < 0) {
      throw new DifferenceFieldError(
        `severity level ${String(level)} is not a finite non-negative number`,
      );
    }
  }
  return [...new Set(levels)].sort((left, right) => left - right);
}

/**
 * The curve of a field at the given levels.
 *
 * `>=`, matching the definition above. Note `C(0) === 1` for every field — every
 * pixel differs by at least zero. If the question is "did anything change at
 * all", `fieldStatistics().changedPixels` answers it; severity `0` does not.
 */
export function differenceCurve(
  field: DifferenceField,
  severityLevels: readonly number[],
): readonly DifferenceCurvePoint[] {
  const levels = normalizeSeverityLevels(severityLevels);
  const { values } = field;
  const total = values.length;

  // One pass per level would be O(levels × pixels). Sorting the levels lets a
  // single pass over the pixels bucket each one into the highest level it meets,
  // after which the counts accumulate downwards. O(pixels + levels).
  const atOrBetween = Array.from<number>({ length: levels.length }).fill(0);

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const bucket = highestLevelMet(levels, value);
    if (bucket >= 0) atOrBetween[bucket] = atOrBetween[bucket]! + 1;
  }

  const points: DifferenceCurvePoint[] = [];
  let running = 0;
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    running += atOrBetween[index]!;
    points[index] = {
      severity: levels[index]!,
      pixelCount: running,
      imageRatio: total === 0 ? 0 : running / total,
    };
  }

  return points;
}

/** Index of the largest level `<=` value, or `-1` when the value meets none. */
function highestLevelMet(levels: readonly number[], value: number): number {
  let low = 0;
  let high = levels.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (levels[middle]! <= value) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}
