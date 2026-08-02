/**
 * An observation — one measured difference between one pair of images.
 *
 * It is a *fact*, and the shape enforces that: there is no verdict field, no
 * threshold, no expectation, and nowhere to put one. A caller who needs a
 * decision makes it outside and keeps it outside, which is what lets one stored
 * observation outlive several generations of the policy that reads it.
 *
 * What it does carry is everything needed to know whether a *later* observation
 * is comparable to it. That list is the whole reason the type is this wide: two
 * numbers taken under different metrics, units, normalisations or severity levels
 * are not a comparison, and the only defence against quietly making one is to
 * record enough to refuse.
 */

import { digestString } from '@variance-authority/core/format';
import {
  assertComparableImages,
  createField,
  type DifferenceField,
  type NormalizedImage,
} from './field.js';
import { differenceCurve, normalizeSeverityLevels, type DifferenceCurvePoint } from './curve.js';
import { descriptorOf, type DifferenceMetric, type MetricDescriptor } from './metric.js';

export const DIFFERENCE_FORMAT_VERSION = 'variance-difference/1';

export interface NormalizationDescriptor {
  readonly version: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface DifferenceObservation {
  readonly formatVersion: string;
  readonly metric: MetricDescriptor;
  readonly image: {
    readonly width: number;
    readonly height: number;
    readonly colorSpace: string;
    readonly alphaMode: string;
  };
  readonly normalization: NormalizationDescriptor;
  readonly field: DifferenceField;
  readonly curve: readonly DifferenceCurvePoint[];
  readonly sourceHashes: {
    readonly firstImage: string;
    readonly secondImage: string;
  };
}

export interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface ImageNormalizationOptions {
  /**
   * Composite straight alpha onto this opaque colour before measuring.
   *
   * The only transform this library performs, and it is opt-in. Everything else
   * a normalizer might do — resampling, colour conversion, gamma correction —
   * changes pixels the caller did not ask to have changed, and would make the
   * difference between two images partly a property of this library.
   */
  readonly flattenOnto?: Rgb;
}

export interface ObserveDifferenceInput {
  readonly firstImage: NormalizedImage;
  readonly secondImage: NormalizedImage;
  readonly metric: DifferenceMetric;
  readonly severityLevels: readonly number[];
  readonly normalization?: ImageNormalizationOptions;
  /**
   * Content hashes of whatever the caller considers the *source*.
   *
   * Supply them when the real source is an encoded file: the hash of a PNG is a
   * more useful identity than the hash of the pixels it decodes to, and only the
   * caller knows which one they have. Omitted, the normalized pixel data is
   * hashed instead, which is correct but coarser — two PNGs that differ only in
   * their compression level hash the same.
   */
  readonly sourceHashes?: {
    readonly firstImage: string;
    readonly secondImage: string;
  };
}

export async function observeDifference(
  input: ObserveDifferenceInput,
): Promise<DifferenceObservation> {
  const { metric } = input;

  assertComparableImages(input.firstImage, input.secondImage);
  const severityLevels = normalizeSeverityLevels(input.severityLevels);

  const normalization = normalizationDescriptor(input.normalization);
  const firstImage = normalizeImage(input.firstImage, input.normalization);
  const secondImage = normalizeImage(input.secondImage, input.normalization);

  const field = await metric.measure({ firstImage, secondImage });
  // A metric is third-party code by design. Re-checking here is what stops a
  // mis-sized or non-finite field from reaching a curve, where it would read as
  // agreement rather than as the failure it is.
  const checked = createField(field.width, field.height, field.values);

  if (checked.width !== firstImage.width || checked.height !== firstImage.height) {
    throw new Error(
      `metric "${metric.name}" returned a ${checked.width}×${checked.height} field for ` +
        `${firstImage.width}×${firstImage.height} images`,
    );
  }

  return {
    formatVersion: DIFFERENCE_FORMAT_VERSION,
    metric: descriptorOf(metric),
    image: {
      width: firstImage.width,
      height: firstImage.height,
      colorSpace: firstImage.colorSpace,
      alphaMode: firstImage.alphaMode,
    },
    normalization,
    field: checked,
    curve: differenceCurve(checked, severityLevels),
    sourceHashes: input.sourceHashes ?? {
      firstImage: hashImage(firstImage),
      secondImage: hashImage(secondImage),
    },
  };
}

function normalizationDescriptor(
  options: ImageNormalizationOptions | undefined,
): NormalizationDescriptor {
  const onto = options?.flattenOnto;
  return {
    version: '1',
    parameters: {
      flattenOnto: onto === undefined ? 'none' : `rgb(${onto.red},${onto.green},${onto.blue})`,
    },
  };
}

function normalizeImage(
  image: NormalizedImage,
  options: ImageNormalizationOptions | undefined,
): NormalizedImage {
  const onto = options?.flattenOnto;
  if (onto === undefined || image.alphaMode !== 'straight') return image;

  const data = new Uint8Array(image.data.length);
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const at = pixel * 4;
    const alpha = image.data[at + 3]! / 255;
    data[at] = Math.round(image.data[at]! * alpha + onto.red * (1 - alpha));
    data[at + 1] = Math.round(image.data[at + 1]! * alpha + onto.green * (1 - alpha));
    data[at + 2] = Math.round(image.data[at + 2]! * alpha + onto.blue * (1 - alpha));
    data[at + 3] = 255;
  }

  return { ...image, data, alphaMode: 'opaque' };
}

/**
 * Content hash of the normalized pixels.
 *
 * `core`'s SHA-256 takes a string, so the bytes are widened one-to-one into code
 * points first. That is injective — distinct byte arrays give distinct strings —
 * so it is a sound content hash, and it keeps this package free of a second hash
 * implementation. Chunked because spreading four megabytes into `fromCharCode`
 * in one call overflows the argument list.
 */
function hashImage(image: NormalizedImage): string {
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let start = 0; start < image.data.length; start += CHUNK) {
    parts.push(String.fromCharCode(...image.data.subarray(start, start + CHUNK)));
  }
  return digestString(`${image.width}x${image.height} ${image.colorSpace} ${parts.join('')}`);
}

/** Severity levels a stored observation was taken at. */
export function severityLevelsOfObservation(
  observation: DifferenceObservation,
): readonly number[] {
  return observation.curve.map((point) => point.severity);
}
