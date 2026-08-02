/**
 * Metrics — the one part that is meant to be replaced.
 *
 * A metric turns two images into one scalar per pixel. Everything else in this
 * package is arithmetic over that array and does not care how it was produced, so
 * pdiff, FLIP, a multiscale comparison, or a plain colour distance all plug in at
 * the same seam.
 *
 * What a metric owes its caller is a **declared unit and range**. "Severity 0.6"
 * is meaningless on its own: on one metric it is most of the way to the maximum
 * possible colour distance, on another it is a fraction of a just-noticeable
 * difference at an assumed viewing distance. A severity level stored against one
 * metric and replayed against another is not a comparison, so the descriptor
 * carries the unit and the comparability check reads it.
 */

import { createField, type DifferenceField, type NormalizedImage } from './field.js';
import { assertComparableImages } from './field.js';

export interface MetricDescriptor {
  readonly name: string;
  readonly version: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  /**
   * What one unit of this metric *is*, as a short stable token.
   *
   * Not decoration. Two metrics whose fields are both "roughly 0 to 1" are not
   * interchangeable, and the only thing standing between a caller and a silently
   * meaningless comparison is this string.
   */
  readonly unit: string;
  /** Inclusive bounds a value can take, or `null` above when unbounded. */
  readonly range: { readonly minimum: number; readonly maximum: number | null };
}

export interface DifferenceMetric extends MetricDescriptor {
  measure(input: {
    readonly firstImage: NormalizedImage;
    readonly secondImage: NormalizedImage;
  }): Promise<DifferenceField>;
}

export function descriptorOf(metric: MetricDescriptor): MetricDescriptor {
  return {
    name: metric.name,
    version: metric.version,
    parameters: metric.parameters,
    unit: metric.unit,
    range: metric.range,
  };
}

/**
 * The maximum possible value of the unnormalized YIQ difference below, reached
 * by black against white. `pixelmatch` uses the same constant, which is what
 * makes the two directly convertible.
 */
const YIQ_MAXIMUM = 35215;

/** Background a straight-alpha pixel is resolved against. */
const WHITE = { red: 255, green: 255, blue: 255 } as const;

/**
 * Colour distance on the YIQ metric, normalised to `[0, 1]`.
 *
 * This is deliberately the *same* arithmetic `pixelmatch` performs, divided by
 * its own maximum — because `pixelmatch` is the differ behind most of the
 * ecosystem, including Playwright's `toHaveScreenshot` and `jest-image-snapshot`,
 * and a curve that could not be read against it would be a private unit nobody
 * can check.
 *
 * The conversion that makes it useful: `pixelmatch` counts a pixel when its raw
 * delta exceeds `35215 · threshold²`, so
 *
 * ```text
 * severity here  =  pixelmatch threshold²
 * ```
 *
 * A `threshold: 0.1` policy is severity `0.01`; a `threshold: 0` policy is any
 * severity above zero. Curve points can therefore be quoted against a
 * configuration somebody else is already running.
 *
 * The equivalence is exact under two conditions, and both are checkable:
 * `includeAA: true`, because `pixelmatch`'s antialias exclusion is a *spatial*
 * predicate over a neighbourhood of both images and is not a magnitude — no
 * threshold on any per-pixel field reproduces it; and `checkerboard: false`,
 * because `pixelmatch` resolves semi-transparent pixels against a checkerboard by
 * default while this resolves them against white. Fully opaque images are
 * unaffected by the second.
 *
 * What it is *not* is a perceptual model. There is no contrast sensitivity
 * function here, no luminance adaptation, no assumed viewing distance — and so
 * also no viewing-condition parameters to record, and no dependence on a declared
 * display for the numbers to mean anything. Metrics that make those assumptions
 * are legitimate and belong behind this same interface; they simply have to
 * declare the assumptions in `parameters`, because their severities are only
 * comparable to severities taken under the same ones.
 */
export const YIQ_DISTANCE: DifferenceMetric = {
  name: 'yiq-distance',
  version: '1',
  parameters: { alphaBackground: 'white' },
  unit: 'yiq-normalized',
  range: { minimum: 0, maximum: 1 },
  measure: async ({ firstImage, secondImage }) => measureYiqDistance(firstImage, secondImage),
};

/**
 * `YIQ_DISTANCE` without the promise.
 *
 * The interface is async so a metric may be a native module, a worker, or a
 * remote service. Every metric shipped here is pure arithmetic over two arrays,
 * so the synchronous form is the real one and is exported for callers who want a
 * pipeline that does not go async for no reason.
 */
export function measureYiqDistance(
  firstImage: NormalizedImage,
  secondImage: NormalizedImage,
): DifferenceField {
  assertComparableImages(firstImage, secondImage);

  const { width, height } = firstImage;
  const values = new Float32Array(width * height);
  const a = firstImage.data;
  const b = secondImage.data;
  const straight = firstImage.alphaMode === 'straight';

  for (let pixel = 0; pixel < values.length; pixel += 1) {
    const at = pixel * 4;

    const r1 = a[at]!;
    const g1 = a[at + 1]!;
    const b1 = a[at + 2]!;
    const a1 = a[at + 3]!;
    const r2 = b[at]!;
    const g2 = b[at + 1]!;
    const b2 = b[at + 2]!;
    const a2 = b[at + 3]!;

    let dr = r1 - r2;
    let dg = g1 - g2;
    let db = b1 - b2;

    if (straight && (a1 < 255 || a2 < 255)) {
      const da = a1 - a2;
      dr = (r1 * a1 - r2 * a2 - WHITE.red * da) / 255;
      dg = (g1 * a1 - g2 * a2 - WHITE.green * da) / 255;
      db = (b1 * a1 - b2 * a2 - WHITE.blue * da) / 255;
    }

    if (dr === 0 && dg === 0 && db === 0) continue;

    const y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
    const i = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189;
    const q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;

    values[pixel] = (0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q) / YIQ_MAXIMUM;
  }

  return createField(width, height, values);
}

/** The `pixelmatch` threshold that gates at the same place as `severity`. */
export function yiqThresholdForSeverity(severity: number): number {
  return Math.sqrt(severity);
}

/** The severity a `pixelmatch` threshold gates at. */
export function yiqSeverityForThreshold(threshold: number): number {
  return threshold * threshold;
}

/**
 * The severity two opaque colours differ by, without an image.
 *
 * A recolour puts the *same* value everywhere it lands, so a colour change known
 * in advance — a design token moving from one value to another — predicts
 * exactly where its mass will sit on the severity axis before anything is
 * rendered. `#2d6cdf → #b5179e` is severity `0.153`.
 *
 * Still only a measurement: it says what a stated colour change is worth, not
 * whether any observed mass at that severity is that change. Deciding that is
 * the caller's, and it needs the field's positions as well as the curve's
 * magnitudes — a token can only license the pixels that were carrying it.
 */
export function severityBetweenColors(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  const dr = first[0] - second[0];
  const dg = first[1] - second[1];
  const db = first[2] - second[2];

  const y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
  const i = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189;
  const q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;

  return (0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q) / YIQ_MAXIMUM;
}

/**
 * Largest absolute channel difference, over 255. No perceptual model at all.
 *
 * Here because a second metric is the only honest way to show the seam is real,
 * and because a comparison that is *meant* to be exact — a rendering pipeline
 * asked to be byte-stable — wants a metric with no forgiveness built into its
 * shape. It weights a change in blue exactly as heavily as the same change in
 * green, which no eye does, and that is the point.
 */
export const CHANNEL_DISTANCE: DifferenceMetric = {
  name: 'channel-distance',
  version: '1',
  parameters: { channels: 'rgba' },
  unit: 'max-channel-over-255',
  range: { minimum: 0, maximum: 1 },
  measure: async ({ firstImage, secondImage }) => measureChannelDistance(firstImage, secondImage),
};

/** `CHANNEL_DISTANCE` without the promise. */
export function measureChannelDistance(
  firstImage: NormalizedImage,
  secondImage: NormalizedImage,
): DifferenceField {
  assertComparableImages(firstImage, secondImage);

  const { width, height } = firstImage;
  const values = new Float32Array(width * height);
  const a = firstImage.data;
  const b = secondImage.data;

  for (let pixel = 0; pixel < values.length; pixel += 1) {
    const at = pixel * 4;
    let worst = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(a[at + channel]! - b[at + channel]!);
      if (delta > worst) worst = delta;
    }
    values[pixel] = worst / 255;
  }

  return createField(width, height, values);
}
