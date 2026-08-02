/**
 * The difference field — one scalar per pixel, and the rules it must obey.
 *
 * A metric answers "how different is this pixel" and nothing else. It does not
 * decide whether the difference matters, where it clusters, or what caused it;
 * those are three later questions with three different owners. What it produces
 * is a plain array of non-negative numbers with a declared unit, which is the
 * smallest artifact that still holds *both* dimensions a comparison has:
 * **how strongly** each pixel differs, and — once positions are kept — **where**.
 *
 * A binary mask is this field thresholded once, by somebody who had to choose the
 * threshold before knowing the answer. Keeping the field defers that choice to
 * the caller, and the caller can make it more than once.
 */

/** Row-major RGBA, 8 bits per channel: what every metric here consumes. */
export interface NormalizedImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major. `length` is exactly `width * height * 4`. */
  readonly data: Uint8Array | Uint8ClampedArray;
  /**
   * Declared, never inferred and never converted. Two images that disagree here
   * are not comparable, and saying so is cheaper than a silent conversion that
   * moves every pixel by a little.
   */
  readonly colorSpace: string;
  /** How the alpha channel was already handled before the metric sees it. */
  readonly alphaMode: AlphaMode;
}

/**
 * `straight` — alpha is live and the metric decides how to resolve it.
 * `premultiplied` — colour channels already carry alpha.
 * `opaque` — alpha is 255 everywhere and carries no information.
 */
export type AlphaMode = 'straight' | 'premultiplied' | 'opaque';

export interface DifferenceField {
  readonly width: number;
  readonly height: number;
  /**
   * Row-major per-pixel difference. Every value is finite and `>= 0`.
   *
   * Zero means *measured, and equal* — not "unmeasured". A metric that cannot
   * evaluate a pixel must fail rather than write a zero, because a field of
   * zeros and a field of unknowns are the same bytes and opposite facts.
   */
  readonly values: Float32Array;
}

export class DifferenceFieldError extends Error {
  override readonly name = 'DifferenceFieldError';
}

/**
 * Build a field, checking the invariants the rest of the package then assumes.
 *
 * The non-finite check is not defensive tidiness. `NaN >= t` is `false` for every
 * `t` including `0`, so a `NaN` pixel is absent from *every* curve point: an
 * all-`NaN` field and a field of two identical images serialize to different
 * bytes and produce an identical curve. A metric that divides by a zero range, or
 * reads past its buffer, would report a perfect match. So it throws instead,
 * for the same reason `core`'s canonicalizer throws on a non-finite number: a
 * non-finite value in a measurement means an upstream measurement failed.
 */
export function createField(width: number, height: number, values: Float32Array): DifferenceField {
  assertDimensions(width, height);

  if (values.length !== width * height) {
    throw new DifferenceFieldError(
      `field is ${values.length} values but ${width}×${height} needs ${width * height}`,
    );
  }

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!Number.isFinite(value)) {
      throw new DifferenceFieldError(
        `field value at index ${index} is ${String(value)}; a non-finite difference means the ` +
          'metric failed, and a failed metric that returns a field reads as a perfect match',
      );
    }
    if (value < 0) {
      throw new DifferenceFieldError(
        `field value at index ${index} is ${value}; a difference is a magnitude and cannot be ` +
          'negative (a *signed* field is what comparing two fields produces, and has its own type)',
      );
    }
  }

  return { width, height, values };
}

export function assertDimensions(width: number, height: number): void {
  for (const [name, value] of [
    ['width', width],
    ['height', height],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new DifferenceFieldError(`${name} must be a positive integer, got ${String(value)}`);
    }
  }
}

/**
 * Both images describe the same grid, in the same colour handling.
 *
 * Deliberately refuses rather than resizing, padding or aligning. Every one of
 * those hides real movement: a subject that grew by a row is a *finding*, and a
 * library that quietly composites it onto a union box has decided, on the
 * caller's behalf, that it was not one. Alignment belongs upstream, where
 * something knows whether the movement was intended.
 */
export function assertComparableImages(first: NormalizedImage, second: NormalizedImage): void {
  assertDimensions(first.width, first.height);
  assertDimensions(second.width, second.height);

  if (first.width !== second.width || first.height !== second.height) {
    throw new DifferenceFieldError(
      `images are ${first.width}×${first.height} and ${second.width}×${second.height}. This ` +
        'library does not resize, pad or align: a size change is a measurement, not a nuisance. ' +
        'Composite them upstream if that is what you meant.',
    );
  }
  if (first.colorSpace !== second.colorSpace) {
    throw new DifferenceFieldError(
      `images declare colour spaces "${first.colorSpace}" and "${second.colorSpace}"`,
    );
  }
  if (first.alphaMode !== second.alphaMode) {
    throw new DifferenceFieldError(
      `images declare alpha modes "${first.alphaMode}" and "${second.alphaMode}"`,
    );
  }

  for (const [side, image] of [
    ['first', first],
    ['second', second],
  ] as const) {
    const expected = image.width * image.height * 4;
    if (image.data.length !== expected) {
      throw new DifferenceFieldError(
        `${side} image is ${image.width}×${image.height} but carries ${image.data.length} bytes, ` +
          `not ${expected} (RGBA, row-major)`,
      );
    }
  }
}

export interface FieldStatistics {
  /** Arithmetic mean over *every* pixel, including the equal ones. */
  readonly mean: number;
  readonly maximum: number;
  /**
   * Pixels with any difference at all — `D > 0`, strictly.
   *
   * Exposed because the curve cannot answer this. `C(t)` counts `D >= t`, so
   * `C(0)` is `1.0` for every field including one from two identical images:
   * every pixel differs by at least nothing. That is the correct reading of the
   * definition and a poor way to ask the question, so the question has its own
   * field.
   */
  readonly changedPixels: number;
  readonly totalPixels: number;
}

export function fieldStatistics(field: DifferenceField): FieldStatistics {
  const { values } = field;
  let sum = 0;
  let maximum = 0;
  let changed = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    sum += value;
    if (value > maximum) maximum = value;
    if (value > 0) changed += 1;
  }

  return {
    mean: values.length === 0 ? 0 : sum / values.length,
    maximum,
    changedPixels: changed,
    totalPixels: values.length,
  };
}
