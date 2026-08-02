/**
 * `@variance-authority/png/difference` — the codec half of known-difference
 * measurement.
 *
 * **Requires a PNG codec**, and that is the only reason it is not in
 * `@variance-authority/raster/difference` with the rest. Decoding is the one step
 * that needs somebody's decoder; the field, the curve, the deltas and the
 * artifact are arithmetic over two arrays and cost nothing, so they live where a
 * caller who already has decoded pixels can reach them without installing this.
 *
 * The split has a practical consequence worth stating: a team whose images arrive
 * as raw RGBA — from a canvas, a WASM renderer, a framebuffer — never installs
 * `pngjs` at all.
 */

import { PNG } from 'pngjs';
import {
  observeDifference,
  type DifferenceObservation,
  type DifferenceMetric,
  type ImageNormalizationOptions,
  type NormalizedImage,
} from '@variance-authority/raster/difference';
import { digestString } from '@variance-authority/core/format';

/**
 * Decode a PNG into the RGBA the metrics consume.
 *
 * `alphaMode` is reported as `straight` whenever the image carries a non-opaque
 * pixel and `opaque` otherwise, because the distinction changes what a metric
 * does and guessing it wrong is silent. Nothing is resampled, converted or
 * colour-managed: `colorSpace` is declared, not detected, for the same reason the
 * rest of the package refuses to align — a conversion this library performs is a
 * difference this library invented.
 */
export function decodeImage(bytes: Buffer, colorSpace = 'srgb'): NormalizedImage {
  const png = PNG.sync.read(bytes);
  const data = new Uint8Array(png.data);

  let opaque = true;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 255) {
      opaque = false;
      break;
    }
  }

  return {
    width: png.width,
    height: png.height,
    data,
    colorSpace,
    alphaMode: opaque ? 'opaque' : 'straight',
  };
}

export interface ObservePngDifferenceInput {
  readonly firstImage: Buffer;
  readonly secondImage: Buffer;
  readonly metric: DifferenceMetric;
  readonly severityLevels: readonly number[];
  readonly normalization?: ImageNormalizationOptions;
  /** Declared, never sniffed. Both images must agree. */
  readonly colorSpace?: string;
}

/**
 * Observe the difference between two PNGs.
 *
 * The source hashes are taken over the **encoded** bytes rather than the decoded
 * pixels, because that is what the caller actually has and can look up again.
 */
export async function observePngDifference(
  input: ObservePngDifferenceInput,
): Promise<DifferenceObservation> {
  const colorSpace = input.colorSpace ?? 'srgb';
  const first = decodeImage(input.firstImage, colorSpace);
  const second = decodeImage(input.secondImage, colorSpace);

  // Two images are the same grid or they are not comparable, and a PNG that
  // decodes to a different alpha mode than its partner is a real difference in
  // how it must be measured — not something to paper over by picking one.
  const firstImage =
    first.alphaMode === second.alphaMode ? first : { ...first, alphaMode: 'straight' as const };
  const secondImage =
    first.alphaMode === second.alphaMode ? second : { ...second, alphaMode: 'straight' as const };

  return observeDifference({
    firstImage,
    secondImage,
    metric: input.metric,
    severityLevels: input.severityLevels,
    ...(input.normalization === undefined ? {} : { normalization: input.normalization }),
    sourceHashes: {
      firstImage: hashBytes(input.firstImage),
      secondImage: hashBytes(input.secondImage),
    },
  });
}

function hashBytes(bytes: Buffer): string {
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(start, start + CHUNK)));
  }
  return digestString(parts.join(''));
}
